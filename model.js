const routes = {
  hang: {name: 'Hang Hau', exit: 'Exit B1', minutes: [18, 17, 21, 16], code: 'HH'},
  choi: {name: 'Choi Hung', exit: 'Exit C2', minutes: [24, 22, 26, 21], code: 'CH'}
};
// Approximate stop and station positions, used as landmarks for the distance check.
const startingStops = {
  campus: {name: 'HKUST North Gate', code: 'UST', description: 'Bus stop · towards MTR', lat: 22.3386, lon: 114.2620},
  hang: {name: 'Hang Hau MTR', code: routes.hang.code, description: 'Meet at Exit B1 · towards HKUST', lat: 22.3156, lon: 114.2644},
  choi: {name: 'Choi Hung MTR', code: routes.choi.code, description: 'Meet at Exit C2 · towards HKUST', lat: 22.3350, lon: 114.2088}
};
const NEARBY_LIMIT_METERS = 1200;

function nearestStartingStop({latitude, longitude, accuracy}) {
  if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy > 1000) return {status: 'uncertain'};
  const radians = degrees => degrees * Math.PI / 180;
  const distance = stop => {
    const latitudeTerm = Math.sin(radians(stop.lat - latitude) / 2) ** 2;
    const longitudeTerm = Math.sin(radians(stop.lon - longitude) / 2) ** 2;
    const arc = latitudeTerm + Math.cos(radians(latitude)) * Math.cos(radians(stop.lat)) * longitudeTerm;
    return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, arc)));
  };
  const nearest = Object.entries(startingStops).map(([key, stop]) => ({key, meters: distance(stop)}))
    .reduce((best, candidate) => candidate.meters < best.meters ? candidate : best);
  return nearest.meters <= NEARBY_LIMIT_METERS ? {status: 'found', ...nearest} : {status: 'outside'};
}
const nodes = {'North Gate': 0, 'Library / Atrium': 3, 'Academic Concourse': 5};
const sizes = {Envelope: 1, 'Small pocket item': 2};
const START_POINTS = 75;
const bucket = time => time < 660 ? 0 : time < 840 ? 1 : time < 1080 ? 2 : 3;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fromTime = time => time.split(':').reduce((hours, minutes) => Number(hours) * 60 + Number(minutes));
const toTime = time => `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;

function pairFeatures(request, trip) {
  const detour = Math.abs(nodes[request.node] - nodes[trip.node]) + 1;
  const overlap = Math.max(0, Math.min(request.end, trip.depart) - Math.max(request.start, trip.depart - 12));
  const fit = Number(request.size <= trip.space);
  const period = bucket(trip.depart);
  const ride = routes[trip.route].minutes[period];
  const arrival = trip.depart + ride + detour;
  const pressure = clamp((60 - (request.end - request.start)) / 60, 0, 1);
  const reason = !fit ? 'Item exceeds pocket capacity' : overlap <= 0 ? 'No pickup window overlap'
    : detour > trip.limit ? 'Detour exceeds tolerance' : arrival > request.end ? 'Arrival misses the deadline' : '';
  return {detour, overlap, fit, ride, arrival, period, pressure, reason, rule: !reason,
    matchInput: [detour, overlap, fit, request.urgency, trip.limit, ride, period],
    priceInput: [1, detour, request.urgency, request.size, pressure, ride]};
}

function generatePairs() {
  let seed = 1945;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const integer = (low, high) => low + Math.floor(random() * (high - low + 1));
  const pick = options => options[integer(0, options.length - 1)];
  const tolerances = [0, ...Array(21).fill(5), ...Array(4).fill(8), ...Array(3).fill(10)];
  const weights = [10, 1.65, 1.75, 2.25, 4, 0.22];
  return Array.from({length: 1200}, () => {
    const route = pick(Object.keys(routes));
    const time = random();
    const period = time < .26 ? 0 : time < .54 ? 1 : time < .78 ? 2 : 3;
    const depart = integer([480, 660, 840, 1080][period], [659, 839, 1079, 1290][period]);
    const start = depart + integer(-45, 12);
    const request = {node: pick(Object.keys(nodes)), size: integer(1, 2), urgency: integer(1, 4), start, end: start + integer(27, 105)};
    const trip = {node: pick(Object.keys(nodes)), route, depart, limit: pick(tolerances), space: random() < .62 ? 2 : 1};
    const features = pairFeatures(request, trip);
    const target = Math.round(features.priceInput.reduce((sum, value, index) => sum + weights[index] * value, 0));
    return {route, ...features, target};
  });
}

function fitLinearRegression(rows) {
  const dimensions = rows[0].priceInput.length;
  const matrix = Array.from({length: dimensions}, () => Array(dimensions + 1).fill(0));
  for (const {priceInput, target} of rows) {
    for (let i = 0; i < dimensions; i++) {
      for (let j = 0; j < dimensions; j++) matrix[i][j] += priceInput[i] * priceInput[j];
      matrix[i][dimensions] += priceInput[i] * target;
    }
  }
  for (let i = 0; i < dimensions; i++) {
    const pivot = matrix[i][i];
    matrix[i] = matrix[i].map(value => value / pivot);
    for (let j = 0; j < dimensions; j++) {
      if (i === j) continue;
      const multiple = matrix[j][i];
      matrix[j] = matrix[j].map((value, column) => value - multiple * matrix[i][column]);
    }
  }
  return matrix.map(row => row[dimensions]);
}

function buildModels() {
  const pairs = generatePairs();
  const train = pairs.slice(0, 840);
  const validation = pairs.slice(840, 1020);
  const test = pairs.slice(1020);
  const means = train[0].matchInput.map((_, i) => train.reduce((sum, row) => sum + row.matchInput[i], 0) / train.length);
  const scales = means.map((mean, i) => Math.sqrt(train.reduce((sum, row) => sum + (row.matchInput[i] - mean) ** 2, 0) / train.length) || 1);
  const normalized = train.map(row => ({rule: row.rule, input: row.matchInput.map((value, i) => (value - means[i]) / scales[i])}));
  function neighbors(features) {
    const input = features.matchInput.map((value, i) => (value - means[i]) / scales[i]);
    return normalized.map(row => ({rule: row.rule,
      distance: row.input.reduce((sum, value, i) => sum + (value - input[i]) ** 2, 0)}))
      .sort((a, b) => a.distance - b.distance).slice(0, 5);
  }
  const votes = features => neighbors(features).filter(row => row.rule).length;
  const coefficients = fitLinearRegression(train);
  const price = features => features.priceInput.reduce((sum, value, i) => sum + value * coefficients[i], 0);
  const score = rows => rows.map(row => ({...row, prediction: votes(row) >= 3, quote: price(row)}));
  return {neighbors, votes, price, coefficients, test: score(test), validation: score(validation)};
}

function metrics(rows, classify) {
  const counts = {tp: 0, fp: 0, fn: 0, tn: 0};
  for (const row of rows) {
    const prediction = classify(row);
    const key = prediction ? (row.rule ? 'tp' : 'fp') : (row.rule ? 'fn' : 'tn');
    counts[key]++;
  }
  const {tp, fp, fn, tn} = counts;
  return {...counts, precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1),
    f1: 2 * tp / (2 * tp + fp + fn || 1), accuracy: (tp + tn) / rows.length};
}

function walletSummary(favors) {
  const held = favors.filter(favor => favor.status === 'held').reduce((sum, favor) => sum + favor.points, 0);
  const paid = favors.filter(favor => favor.status === 'delivered').reduce((sum, favor) => sum + favor.points, 0);
  return {held, paid, available: START_POINTS - held - paid};
}

function reserve(favors, favor) {
  if (walletSummary(favors).available < favor.points || favors.some(entry => entry.tripId === favor.tripId && entry.status !== 'cancelled')) return false;
  favors.push({...favor, status: 'held'});
  return true;
}

function settle(favors, id, status) {
  const favor = favors.find(entry => entry.id === id && entry.status === 'held');
  if (!favor || !['delivered', 'cancelled'].includes(status)) return false;
  if (Boolean(favor.pickedUpAt) !== (status === 'delivered')) return false;
  favor.status = status;
  favor.settledAt = Date.now();
  return true;
}

function markPickup(favors, id) {
  const favor = favors.find(entry => entry.id === id && entry.status === 'held' && !entry.pickedUpAt);
  if (!favor) return false;
  favor.pickedUpAt = Date.now();
  return true;
}

function validateLedger() {
  let checks = 0;
  for (let trial = 0; trial < 20; trial++) {
    const favors = [];
    const points = 20 + trial % 6;
    const firstHeld = reserve(favors, {id: 'a', tripId: 'a', points});
    const firstOkay = firstHeld && walletSummary(favors).held === points && walletSummary(favors).available === START_POINTS - points;
    const duplicateBlocked = !reserve(favors, {id: 'dup', tripId: 'a', points});
    const overspendBlocked = !reserve(favors, {id: 'big', tripId: 'b', points: START_POINTS});
    const pickupRequired = !settle(favors, 'a', 'delivered') && markPickup(favors, 'a')
      && !markPickup(favors, 'a') && !settle(favors, 'a', 'cancelled') && walletSummary(favors).held === points;
    const delivered = settle(favors, 'a', 'delivered');
    const paidOnce = pickupRequired && delivered && !settle(favors, 'a', 'delivered') && walletSummary(favors).paid === points && walletSummary(favors).held === 0;
    const secondHeld = reserve(favors, {id: 'c', tripId: 'c', points: 15});
    const refunded = secondHeld && settle(favors, 'c', 'cancelled') && walletSummary(favors).available === START_POINTS - points;
    checks += [firstOkay, duplicateBlocked, overspendBlocked, paidOnce, refunded].filter(Boolean).length;
  }
  return checks;
}
