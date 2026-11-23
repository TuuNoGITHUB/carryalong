const $ = id => document.getElementById(id);
const bySelector = selector => Array.from(document.querySelectorAll(selector));
const requestForm = $('request-form');
const dialog = $('detail-dialog');
const models = buildModels();
const storageKey = 'carryalong-demo-v1';
const scenarios = {
  standard: {route: 'hang', direction: 'out', node: 'Library / Atrium', size: 1, urgency: 2, start: 840, end: 900},
  tight: {route: 'hang', direction: 'out', node: 'Library / Atrium', size: 1, urgency: 4, start: 840, end: 870},
  pocket: {route: 'choi', direction: 'out', node: 'North Gate', size: 3, urgency: 2, start: 840, end: 915,
    instructions: 'Please keep the takeaway bag upright.'}
};
const seedTrips = [
  {id: 't1', name: 'Mira', route: 'hang', direction: 'out', node: 'North Gate', depart: 856, limit: 9, space: 2},
  {id: 't2', name: 'Jay', route: 'hang', direction: 'out', node: 'Academic Concourse', depart: 869, limit: 7, space: 2},
  {id: 't3', name: 'Sophie', route: 'hang', direction: 'out', node: 'Library / Atrium', depart: 886, limit: 5, space: 2},
  {id: 't4', name: 'Alex', route: 'choi', direction: 'out', node: 'North Gate', depart: 852, limit: 5, space: 1},
  {id: 't5', name: 'Noor', route: 'choi', direction: 'out', node: 'North Gate', depart: 864, limit: 5, space: 3},
  {id: 't6', name: 'Sam', route: 'choi', direction: 'out', node: 'Academic Concourse', depart: 876, limit: 5, space: 2},
  {id: 't7', name: 'Luca', route: 'hang', direction: 'in', node: 'North Gate', depart: 856, limit: 5, space: 2},
  {id: 't8', name: 'Mei', route: 'choi', direction: 'in', node: 'Library / Atrium', depart: 862, limit: 8, space: 2}
];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.trips) && Array.isArray(saved.favors)) return saved;
  } catch { /* The simulation also works in memory when browser storage is unavailable. */ }
  return null;
}

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { /* Keep the current demo session usable. */ }
}

let state = loadState() ?? {trips: [], favors: []};
let request = {...scenarios.standard};
let evaluated = [];
let preferredTripId;
let openPassId;
let toastTimer;
let challengeTimer;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

function uniqueId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function updateState(change) {
  const run = () => {
    state = loadState() ?? state;
    const result = change();
    persist();
    render();
    return result;
  };
  const hosted = location.protocol === 'https:' || location.protocol === 'http:';
  return hosted && navigator.locks?.request ? navigator.locks.request(storageKey, run) : Promise.resolve(run());
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3700);
}

function routeLabel(route, direction, campus = 'HKUST') {
  return direction === 'out' ? `${campus} → ${routes[route].name}` : `${routes[route].name} → ${campus}`;
}

function handoffStops(candidate) {
  const station = `${routes[candidate.trip.route].name} ${routes[candidate.trip.route].exit}`;
  const campus = `HKUST ${request.node}`;
  const pair = request.direction === 'out' ? [campus, station] : [station, campus];
  const stopLabel = (label, pin, fallback) => pin ? `${label || 'Map pin'} (${pin})` : label || fallback;
  return [stopLabel(request.pickupLabel, request.pickupPin, pair[0]), stopLabel(request.dropoffLabel, request.dropoffPin, pair[1])];
}

function handoffLabel(candidate) { return handoffStops(candidate).join(' → '); }

function savedHandoffStops(favor) {
  return favor.pickup ? [favor.pickup, favor.dropoff] : favor.handoff.split(' → ');
}

function readRequestPins(form) {
  const anchors = form.direction === 'out' ? [startingStops.campus, startingStops[form.route]] : [startingStops[form.route], startingStops.campus];
  const [pickup, dropoff] = [estimatePinWalk(form.pickupPin, anchors[0]), estimatePinWalk(form.dropoffPin, anchors[1])];
  return {anchors, pickup, dropoff};
}

function updateRequestExtras() {
  const form = Object.fromEntries(new FormData(requestForm));
  const {anchors, pickup, dropoff} = readRequestPins(form);
  $('size-hint').hidden = form.size !== '3';
  $('pickup-anchor').textContent = `near ${anchors[0].name}`;
  $('dropoff-anchor').textContent = `near ${anchors[1].name}`;
  $('pickup-pin').placeholder = `e.g. ${anchors[0].lat.toFixed(4)}, ${anchors[0].lon.toFixed(4)}`;
  $('dropoff-pin').placeholder = `e.g. ${anchors[1].lat.toFixed(4)}, ${anchors[1].lon.toFixed(4)}`;
  const estimates = [pickup, dropoff].map((pin, index) => pin.error ? `${index === 0 ? 'Pickup' : 'Drop-off'}: ${pin.error}` : pin.minutes === undefined ? ''
    : `${index === 0 ? 'Pickup' : 'Drop-off'} pin: ${pin.minutes} min from ${anchors[index].name}.`);
  $('pin-estimate').textContent = estimates.filter(Boolean).join(' ');
}

function drawMap() {
  const canvas = $('map-canvas');
  const {width, height} = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.lineCap = 'round';

  // Decorative contour traces keep the foreground route diagram easy to read.
  for (let i = 0; i < 13; i++) {
    ctx.beginPath();
    const trace = i * 10;
    ctx.moveTo(-10, 10 + trace);
    ctx.bezierCurveTo(width * .19, trace - 22, width * .16, trace + 24, width * .41, trace + 30);
    ctx.bezierCurveTo(width * .63, trace + 40, width * .64, trace - 28, width + 10, trace - 10);
    ctx.lineWidth = 1;
    ctx.strokeStyle = i % 4 === 0 ? '#d5f38425' : '#bcdbc016';
    ctx.stroke();
  }

  const stationX = width * .66;
  const campus = [width * .12, height * .49];
  const branch = [width * .34, height * .49];
  const terminals = {choi: [stationX, height * .25], hang: [stationX, height * .70]};
  function path(terminal, color, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(...campus);
    ctx.lineTo(...branch);
    ctx.bezierCurveTo(width * .49, branch[1], width * .47, terminal[1], width * .6, terminal[1]);
    ctx.lineTo(...terminal);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  const activeRoute = requestForm.elements.route.value;
  const inactive = activeRoute === 'choi' ? 'hang' : 'choi';
  path(terminals[inactive], '#8da596', 2.4);
  path(terminals[activeRoute], '#daf58d30', 10);
  path(terminals[activeRoute], '#daf58d', 3);
  for (const [point, active] of [[campus, true], [terminals[inactive], false], [terminals[activeRoute], true]]) {
    ctx.beginPath();
    ctx.arc(...point, active ? 6 : 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#18382e';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = active ? '#daf58d' : '#9caf9f';
    ctx.stroke();
  }
  canvas.parentElement.setAttribute('aria-label', `Schematic of HKUST to Choi Hung and Hang Hau. Selected corridor: ${routes[activeRoute].name}.`);
}

function allTrips() { return [...seedTrips, ...state.trips]; }

function evaluateTrips() {
  const sort = $('sort-matches').value;
  const bestFit = (a, b) => b.votes - a.votes || a.neighborDistance - b.neighborDistance
    || a.features.detour - b.features.detour || a.features.arrival - b.features.arrival;
  const order = {
    fit: bestFit,
    arrival: (a, b) => a.features.arrival - b.features.arrival,
    points: (a, b) => a.points - b.points
  }[sort];
  const candidates = allTrips().filter(trip => trip.route === request.route && trip.direction === request.direction).map(trip => {
    const features = pairFeatures(request, trip);
    const neighbors = models.neighbors(features);
    const votes = neighbors.filter(row => row.rule).length;
    const predicted = votes >= 3;
    const existing = state.favors.find(favor => favor.tripId === trip.id && favor.status !== 'cancelled');
    const feasible = predicted && features.rule;
    const neighborDistance = neighbors.reduce((total, neighbor) => total + neighbor.distance, 0) / neighbors.length;
    return {trip, features, neighbors, votes, neighborDistance, predicted, feasible, existing,
      points: Math.max(1, Math.round(models.price(features))), available: feasible && !existing};
  });
  const recommended = candidates.filter(candidate => candidate.available).sort(bestFit)[0];
  if (recommended) recommended.recommended = true;
  return candidates.sort((a,b) => Number(b.available) - Number(a.available) || Number(b.feasible) - Number(a.feasible)
    || order(a, b) || a.features.arrival - b.features.arrival);
}

function pill(candidate) {
  if (candidate.existing) return `<span class="pill ${candidate.existing.status === 'delivered' ? 'good' : ''}">${handoffStatus(candidate.existing)}</span>`;
  if (candidate.recommended) return '<span class="pill recommended">Our recommended</span>';
  if (candidate.feasible) return `<span class="pill good">${candidate.trip.id === preferredTripId ? 'Selected trip' : 'Feasible'}</span>`;
  return `<span class="pill ${candidate.predicted ? 'warn' : ''}">${candidate.predicted ? 'Rule blocked' : 'Not feasible'}</span>`;
}

function traveler(trip) {
  const campus = trip.direction === 'in' ? `Campus via ${trip.node}` : trip.node;
  return `<div class="traveler"><span class="avatar" aria-hidden="true">${trip.name.slice(0, 2).toUpperCase()}</span><div><h3>${trip.name}</h3><p>Departs ${toTime(trip.depart)} · ${campus}</p></div></div>`;
}

function reviewButton(candidate) {
  const insufficient = walletSummary(state.favors).available < candidate.points;
  return `<button class="button primary" data-review="${candidate.trip.id}" ${insufficient ? 'disabled' : ''}>${insufficient ? 'Insufficient points' : `Review · ${candidate.points} pts`}</button>`;
}

function featuredCard(candidate) {
  const {trip, features, points} = candidate;
  return `<article class="result-card featured" data-trip="${trip.id}">
    <div class="card-top">${traveler(trip)}${pill(candidate)}</div>
    <div class="journey-facts">
      <div class="fact"><span>Arrives by</span><strong>${toTime(features.arrival)}</strong></div>
      <div class="fact"><span>Extra time</span><strong>+${features.detour} min</strong></div>
      <div class="fact"><span>Point quote</span><strong>${points} pts</strong></div>
    </div>
    <p class="match-support">Capacity: ${sizes[trip.space]} · ${features.overlap} min pickup overlap</p>
    <div class="detour"><strong id="meter-label-${trip.id}">Detour Meter</strong><span>${features.detour} min / ${trip.limit} min limit</span>
      <progress aria-labelledby="meter-label-${trip.id}" aria-valuetext="${features.detour} minutes out of ${trip.limit} allowed" max="${trip.limit}" value="${features.detour}"></progress></div>
    <div class="card-bottom"><button type="button" data-explain="${trip.id}" class="text-button">Why this match?</button>${reviewButton(candidate)}</div>
  </article>`;
}

function compactCard(candidate) {
  const {trip, features} = candidate;
  const summary = candidate.existing ? `${candidate.existing.points} pts ${candidate.existing.status === 'held' ? 'on hold' : 'paid'}`
    : candidate.feasible ? `<strong>${candidate.points} pts</strong> · ${features.detour} min detour · ETA ${toTime(features.arrival)}`
      : features.reason || 'KNN voted against this match';
  const action = candidate.existing ? `<button type="button" class="text-button" data-pass="${candidate.existing.id}">View pass</button>`
    : `<button type="button" class="text-button" data-explain="${trip.id}">${candidate.available ? 'Review match' : 'Details'}</button>`;
  return `<article class="result-card" data-trip="${trip.id}"><div class="card-top">${traveler(trip)}${pill(candidate)}</div>
    <div class="compact-actions"><p class="compact-facts">${summary}</p>${action}</div></article>`;
}

function renderResults() {
  const expanded = $('unavailable-trips')?.open;
  evaluated = evaluateTrips();
  const open = evaluated.filter(candidate => candidate.available);
  const blocked = evaluated.filter(candidate => !candidate.available);
  const item = sizes[request.size];
  $('result-ticket').dataset.route = request.route;
  $('result-ticket').querySelector('.line-mark').textContent = routes[request.route].code;
  $('result-context').textContent = `${routeLabel(request.route, request.direction)} · ${item}`;
  $('result-window').textContent = `Ready from ${toTime(request.start)} · Deliver by ${toTime(request.end)}`;
  const missingPin = (request.pickupLabel && !request.pickupPin) || (request.dropoffLabel && !request.dropoffPin);
  const hasPin = request.pickupPin || request.dropoffPin;
  const notes = [hasPin ? 'Pin detours use straight-line distance at 75 m/min.' : '', missingPin ? 'Confirm unpinned locations and any extra walking time with the traveler.' : ''];
  $('result-detour-note').textContent = notes.filter(Boolean).join(' ');
  $('result-detour-note').hidden = !hasPin && !missingPin;
  $('result-count').textContent = `${open.length} feasible`;
  $('match-status').textContent = `${open.length} feasible unbooked matches out of ${evaluated.length} trips.`;
  $('results-sort').hidden = open.length < 2;
  let notice = '';
  if (!evaluated.length) notice = '<div class="notice"><h3>No trips on this corridor and direction</h3><p>Switch corridors or post a trip to try this combination.</p></div>';
  else if (!open.length) {
    const minutes = Math.min(30, 1439 - request.end);
    const timeBlock = blocked.some(candidate => !candidate.existing && ['Arrival misses the deadline', 'No pickup window overlap'].includes(candidate.features.reason));
    const retry = minutes && timeBlock ? `<button type="button" class="button secondary" id="extend-window">Try with ${minutes} more minutes</button>` : '';
    notice = `<div class="notice"><h3>No reservable trip yet</h3><p>Review individual trips to see what blocked a match.</p>${retry}</div>`;
  }
  const availableCards = open.map((candidate, i) => i === 0 ? featuredCard(candidate) : compactCard(candidate)).join('');
  const blockedCards = blocked.length ? `<details class="blocked-trips" id="unavailable-trips" ${!open.length || expanded ? 'open' : ''}><summary>Unavailable trips <span>${blocked.length}</span></summary><div>${blocked.map(compactCard).join('')}</div></details>` : '';
  $('results').innerHTML = notice + availableCards + blockedCards;
  drawMap();
}

function renderTrips() {
  const route = $('filter-route').value;
  const direction = $('filter-direction').value;
  const trips = allTrips().filter(trip => (route === 'all' || trip.route === route) && (direction === 'all' || trip.direction === direction))
    .sort((a,b) => Number(Boolean(b.posted)) - Number(Boolean(a.posted)) || a.depart - b.depart);
  $('trip-count').textContent = `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}`;
  $('trip-list').innerHTML = trips.map(trip => {
    const activity = state.favors.find(favor => favor.tripId === trip.id && favor.status !== 'cancelled');
    const status = activity ? handoffStatus(activity) : trip.posted ? 'Just posted' : 'Sample trip';
    return `<article class="result-card trip-card" data-route="${trip.route}"><div class="trip-line"><span class="line-mark" aria-hidden="true">${routes[trip.route].code}</span><strong>${routeLabel(trip.route, trip.direction)}</strong></div>
      <div class="card-top">${traveler(trip)}<span class="pill">${status}</span></div>
      <div class="compact-actions"><p class="compact-facts">${trip.limit} min max detour · ${sizes[trip.space]}</p>
      ${activity ? `<button type="button" class="text-button" data-pass="${activity.id}">View pass</button>` : `<button type="button" class="text-button" data-prep-trip="${trip.id}">Plan a favor</button>`}</div></article>`;
  }).join('') || '<div class="notice"><h3>No trips for these filters</h3><p>Change the corridor or direction to see more trips.</p></div>';
}

function metricCard(label, value, description) {
  return `<article class="panel metric-card"><span>${label}</span><strong>${value}</strong><p>${description}</p></article>`;
}

function handoffStatus(favor) {
  if (favor.status === 'delivered') return 'Delivered';
  if (favor.status === 'cancelled') return 'Cancelled';
  if (favor.pickedUpAt) return 'In transit';
  return needsAcceptance(favor) ? 'Awaiting acceptance' : 'Ready for pickup';
}

function passCard(favor) {
  const stage = handoffStatus(favor);
  return `<button class="pass-card" type="button" data-pass="${favor.id}" data-route="${favor.route}">
    <span class="line-mark" aria-hidden="true">${routes[favor.route].code}</span>
    <span><strong>${favor.name} · ${favor.item}</strong><small>${stage} · ${favor.points} pts held</small></span><span class="chevron" aria-hidden="true"></span></button>`;
}

const ledgerTime = new Intl.DateTimeFormat('en-HK', {timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false});

function renderWallet() {
  const {available, held, paid} = walletSummary(state.favors);
  const earned = new Map();
  const deliveredFavors = state.favors.filter(entry => entry.status === 'delivered');
  const bonuses = deliveredFavors.reduce((total, favor) => total + earnedBonus(favor), 0);
  for (const favor of deliveredFavors) {
    earned.set(favor.name, (earned.get(favor.name) ?? 0) + favor.points + earnedBonus(favor));
  }
  $('header-points').textContent = available;
  $('header-points').closest('button').setAttribute('aria-label', `Points wallet, ${available} points available`);
  $('wallet-summary').innerHTML = metricCard('Available', `${available} pts`, 'Sender balance')
    + metricCard('On hold', `${held} pts`, 'Awaiting delivery') + metricCard('Paid out', `${paid} pts`, bonuses ? `Plus ${bonuses} demo bonus pts` : 'Confirmed deliveries');
  const history = [...state.favors].reverse();
  const active = history.filter(favor => favor.status === 'held');
  const complete = history.filter(favor => favor.status !== 'held');
  $('home-activity').hidden = !active.length;
  $('active-favors').hidden = !active.length;
  $('home-passes').innerHTML = active.map(passCard).join('');
  $('active-passes').innerHTML = active.map(passCard).join('');
  $('ledger-list').innerHTML = complete.length ? complete.map(favor => {
    const delivered = favor.status === 'delivered';
    const status = delivered ? `${favor.points} pts paid` : `${favor.points} pts returned`;
    const activity = `${delivered ? 'Delivered' : 'Cancelled'} at ${ledgerTime.format(favor.settledAt)} HKT`;
    const bonus = earnedBonus(favor);
    const message = delivered ? `${favor.name} received ${favor.points} pts${bonus ? ` + ${bonus} bonus pts` : ''} (current balance ${START_POINTS + earned.get(favor.name)} pts).` : 'Points returned to your balance.';
    return `<article class="ledger-row"><div><h3>${favor.name} · ${favor.item}</h3><p>${escapeHtml(favor.handoff)} · ETA ${favor.eta}</p><p>${activity}</p><p>${message}</p></div>
      <span class="pill ${delivered ? 'good' : ''}">${status}</span><button type="button" class="text-button" data-pass="${favor.id}">View pass</button></article>`;
  }).join('') : '<div class="notice"><h3>No completed handoffs yet</h3><p>Confirmed and cancelled favors will appear here.</p></div>';
}

function renderBenchmark() {
  const route = $('eval-route').value;
  const rows = models[$('eval-split').value].filter(row => route === 'all' || row.route === route);
  const knn = metrics(rows, row => row.prediction);
  const baseline = metrics(rows, row => row.rule);
  const mae = rows.reduce((sum, row) => sum + Math.abs(row.target - row.quote), 0) / rows.length;
  $('model-summary').innerHTML = metricCard('KNN F1', knn.f1.toFixed(3), '5 nearest neighbors')
    + metricCard('Pricing MAE', `${mae.toFixed(2)} pts`, 'Linear regression')
    + metricCard('Evaluated pairs', rows.length, `${$('eval-split').selectedOptions[0].text} · ${$('eval-route').selectedOptions[0].text}`);
  const row = (name, metric) => `<tr><th scope="row">${name}</th>${['precision', 'recall', 'f1', 'accuracy'].map(key => `<td>${metric[key].toFixed(3)}</td>`).join('')}</tr>`;
  $('benchmark').innerHTML = `<div class="table-wrap" tabindex="0" aria-label="Model comparison table"><table><thead><tr><th scope="col">Method</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">F1</th><th scope="col">Accuracy</th></tr></thead>
    <tbody>${row('KNN', knn)}${row('Rule baseline', baseline)}</tbody></table></div>
    <p class="benchmark-note">KNN flagged ${knn.fp} infeasible ${knn.fp === 1 ? 'pair' : 'pairs'} as feasible and missed ${knn.fn} feasible ${knn.fn === 1 ? 'pair' : 'pairs'}. The rule baseline reproduces the rule that generated the labels.</p>`;
  $('ledger-checks').textContent = `${validateLedger()}/100 ledger checks passed across holds, payouts, cancellations and blocked transactions.`;
}

function render() {
  renderResults();
  renderTrips();
  renderWallet();
}

function focusScreen(screen) {
  const heading = [...screen.querySelectorAll('h1')].find(element => !element.closest('[hidden]'));
  heading.tabIndex = -1;
  heading.focus({preventScroll: true});
  window.scrollTo(0, 0);
}

function switchScreen(name) {
  const screen = $(`${name}-screen`);
  for (const sibling of screen.parentElement.children) sibling.hidden = sibling !== screen;
  if (name === 'request') drawMap();
  focusScreen(screen);
}

function switchView(view, screen) {
  bySelector('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  bySelector('.navigation button').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (screen) switchScreen(screen);
  else {
    if (view === 'match') drawMap();
    focusScreen($(`view-${view}`));
  }
}

function fillRequest(values, trip) {
  request = {...values};
  preferredTripId = trip?.id;
  delete requestForm.dataset.startStop;
  $('request-intro').textContent = trip ? `Prefilled for ${trip.name}’s ${toTime(trip.depart)} departure.` : 'Choose where and when your item needs to go.';
  for (const key of ['route', 'direction', 'node', 'size', 'urgency', 'start', 'end', 'pickupLabel', 'dropoffLabel', 'pickupPin', 'dropoffPin', 'instructions']) {
    requestForm.elements[key].value = ['start', 'end'].includes(key) ? toTime(values[key]) : values[key] ?? '';
  }
  $('request-extras').open = false;
  updateRequestExtras();
  $('request-error').hidden = true;
  $('sort-matches').value = 'fit';
  if ($('unavailable-trips')) $('unavailable-trips').open = false;
  renderResults();
}

function planTrip(id) {
  const trip = allTrips().find(entry => entry.id === id);
  if (!trip) return;
  const {route, direction, node, depart} = trip;
  const start = Math.max(0, depart - 12);
  const end = Math.min(1439, depart + routes[route].minutes[bucket(depart)] + 25);
  fillRequest({route, direction, node, size: 1, urgency: 2, start, end}, trip);
  switchView('match', 'request');
}

function showSheet(passId) {
  clearInterval(challengeTimer);
  openPassId = passId;
  const title = $('dialog-title');
  title.tabIndex = -1;
  title.setAttribute('autofocus', '');
  if (!dialog.open) dialog.showModal();
  else title.focus({preventScroll: true});
  dialog.scrollTop = 0;
}

function showNearby(context) {
  const options = Object.entries(startingStops).map(([key, stop]) => `<label class="stop-option" data-route="${key}">
    <span class="line-mark" aria-hidden="true">${stop.code}</span><span><strong>${stop.name}</strong><small>${stop.description}</small></span>
    <input type="radio" name="starting-stop" value="${key}"></label>`).join('');
  const actions = (context === 'home' ? ['request', 'trip'] : [context]).map((target, index) =>
    `<button type="button" class="button ${index === 0 ? 'primary' : 'secondary'}" data-use-stop="${target}" disabled>Use in ${target}</button>`).join('');
  $('dialog-content').innerHTML = `<h2 id="dialog-title">Find your starting stop</h2><p>Your location is used once on this device to suggest a stop.</p>
    <div class="location-actions"><button type="button" class="button primary" id="locate-device"><span class="location-icon" aria-hidden="true"></span>Use my location</button>
    <button type="button" class="button secondary" id="locate-sample">Try a sample location</button></div>
    <p id="nearby-status" class="nearby-status" role="status" hidden></p>
    <fieldset class="stop-options" id="stop-options"><legend>Choose a starting stop</legend>${options}</fieldset>
    <div class="apply-stop">${actions}</div>`;
  $('stop-options').addEventListener('change', () => {
    bySelector('[data-use-stop]').forEach(button => { button.disabled = false; });
  });
  showSheet();
}

function showStopSuggestion(result, status, initialStop, sample) {
  if (!dialog.open || $('nearby-status') !== status) return;
  if (result.status === 'found') {
    const distance = result.meters < 100 ? 'within 100 m' : `about ${Math.round(result.meters / 50) * 50} m away`;
    status.textContent = `${sample ? 'Sample location' : 'Closest supported stop'} · ${startingStops[result.key].name}, ${distance} in a straight line.`;
    const selected = $('stop-options').querySelector('input:checked');
    if (sample || selected === initialStop) {
      const option = $('stop-options').querySelector(`input[value="${result.key}"]`);
      option.checked = true;
      option.dispatchEvent(new Event('change', {bubbles: true}));
    }
  } else {
    status.textContent = result.status === 'outside' ? 'You’re outside the demo’s nearby-stop area. Choose any supported stop below.'
      : 'Your location is too approximate to suggest a stop. Choose a stop below.';
  }
  $('locate-device').disabled = false;
  $('locate-sample').disabled = false;
}

function detectStartingStop() {
  const status = $('nearby-status');
  const initialStop = $('stop-options').querySelector('input:checked');
  status.hidden = false;
  if (!navigator.geolocation) {
    status.textContent = 'Location is unavailable in this browser. Choose a stop below.';
    return;
  }
  status.textContent = 'Waiting for your device’s location…';
  $('locate-device').disabled = true;
  $('locate-sample').disabled = true;
  navigator.geolocation.getCurrentPosition(position => {
    showStopSuggestion(nearestStartingStop(position.coords), status, initialStop, false);
  }, error => {
    if (!dialog.open || $('nearby-status') !== status) return;
    status.textContent = error.code === 1 ? 'Location access was declined or blocked. Choose a stop below.'
      : 'Your device couldn’t find a location. Try again or choose a stop below.';
    $('locate-device').disabled = false;
    $('locate-sample').disabled = false;
  }, {maximumAge: 0, timeout: 9000});
}

function applyStartingStop(target) {
  const key = $('stop-options').querySelector('input:checked')?.value;
  if (!key) return;
  const form = target === 'request' ? requestForm : $('trip-form');
  form.elements.direction.value = key === 'campus' ? 'out' : 'in';
  if (key === 'campus') form.elements.node.value = 'North Gate';
  else form.elements.route.value = key;
  form.dataset.startStop = key;
  $(`${target}-intro`).textContent = `Starting at ${startingStops[key].name}. You can change the route below.`;
  if (target === 'request') {
    preferredTripId = undefined;
    $('request-error').hidden = true;
    updateRequestExtras();
  }
  dialog.close();
  if (target === 'request') switchView('match', 'request');
  else switchView('trips', 'post');
}

function explain(candidate) {
  const {trip, features, neighbors, predicted, votes, points} = candidate;
  const marks = neighbors.map(row => `<span class="${row.rule ? 'vote-good' : ''}" aria-hidden="true">${row.rule ? '✓' : '×'}</span>`).join('');
  const stage = candidate.existing ? `<p>Wallet status: ${candidate.existing.status === 'held' ? 'Reserved' : 'Delivered'}</p>` : '';
  const checks = [features.fit ? 'Item fits' : 'Item does not fit', `${features.overlap} min pickup overlap`,
    `${features.detour} min detour (limit ${trip.limit})`, `ETA ${toTime(features.arrival)} (deadline ${toTime(request.end)})`];
  const pricing = ['Base', 'Detour', 'Urgency', 'Item size', 'Time pressure', 'Ride time'].map((label, index) => {
    const contribution = models.coefficients[index] * features.priceInput[index];
    return `<dt>${label}</dt><dd>${contribution.toFixed(1)} pts</dd>`;
  }).join('');
  $('dialog-content').innerHTML = `<h2 id="dialog-title">${trip.name}’s match details</h2><p>${escapeHtml(handoffLabel(candidate))}</p>${stage}
    <div class="dialog-block"><h3>KNN verdict · ${predicted ? 'Feasible' : 'Not feasible'}</h3><div class="neighbor-strip">${marks}</div>
    <p>${votes} of 5 nearby training examples were feasible. Candidates first share the same corridor and direction. The recommendation ranks eligible trips by feasible KNN votes, then by similarity to the five neighbors.</p>
    <p>Urgency ${request.urgency} · ${['Morning', 'Midday', 'Afternoon', 'Evening'][features.period]} · ${features.ride} min ride</p></div>
    <div class="dialog-block"><h3>Rule baseline · ${features.rule ? 'Pass' : features.reason}</h3><p>${checks.join(' · ')}.</p>
    <p>Detour: ${features.campusWalk} min campus walk + ${features.stationWalk} min station walk + 1 min handoff. Reservations require a feasible vote and a rule pass.</p></div>
    <div class="dialog-block"><h3>Regression quote · ${points} pts</h3><p>The model adds these contributions and rounds the total to a whole point.</p><details class="pricing-details"><summary>Show price breakdown</summary><dl>${pricing}</dl></details></div>
    ${candidate.available ? reviewButton(candidate) : ''}`;
  showSheet();
}

function reviewReservation(candidate) {
  if (!candidate?.available) return;
  const {trip, features, points} = candidate;
  const available = walletSummary(state.favors).available;
  $('dialog-content').innerHTML = `<h2 id="dialog-title">Review reservation</h2><p>${trip.name} · ${escapeHtml(handoffLabel(candidate))}</p>
    <div class="quote-box"><dl><dt>Estimated arrival</dt><dd>${toTime(features.arrival)}</dd><dt>Estimated journey</dt><dd>${features.ride + features.detour} min</dd><dt>Points held</dt><dd>${points} pts</dd><dt>Balance after hold</dt><dd>${Math.max(0, available - points)} pts</dd></dl></div>
    ${request.instructions ? `<p class="handoff-instructions"><strong>Instructions</strong>${escapeHtml(request.instructions)}</p>` : ''}
    <p>${available < points ? 'Your points balance is too low for this trip.' : 'Confirm delivery to release the held points to the traveler.'}</p>
    <button type="button" class="button primary sheet-action" data-reserve="${trip.id}" ${available < points ? 'disabled' : ''}>Reserve for ${points} pts</button>`;
  showSheet();
}

function showPass(id) {
  const favor = state.favors.find(entry => entry.id === id);
  if (!favor) return;
  const held = favor.status === 'held';
  const delivered = favor.status === 'delivered';
  const cancelled = favor.status === 'cancelled';
  const pickedUp = Boolean(favor.pickedUpAt) || delivered;
  const awaiting = held && needsAcceptance(favor);
  const [pickup, dropoff] = savedHandoffStops(favor);
  const pickupWindow = favor.pickupWindow ? `Pickup ${favor.pickupWindow}` : 'Meet at the pickup node';
  const stage = handoffStatus(favor);
  const progressStep = delivered ? 'Delivered' : pickedUp ? 'Picked up' : awaiting ? 'Offered' : 'Accepted';
  const progress = cancelled ? '<li class="complete">Reserved</li><li class="complete" aria-current="step">Refunded</li>'
    : ['Offered', 'Accepted', 'Picked up', 'Delivered'].map((step, index, steps) =>
      `<li class="${index <= steps.indexOf(progressStep) ? 'complete' : ''}"${step === progressStep ? ' aria-current="step"' : ''}>${step}</li>`).join('');
  const beforePickup = awaiting ? `<button type="button" class="button primary" data-accept="${favor.id}">Accept as traveler</button>`
    : `<button type="button" class="button primary" data-pickup="${favor.id}">Mark picked up</button>`;
  const action = held ? (pickedUp
    ? `<button type="button" class="button primary" data-settle="${favor.id}" data-status="delivered">Confirm delivery</button>`
    : `${beforePickup}<button type="button" class="button secondary" data-settle="${favor.id}" data-status="cancelled">Cancel and refund</button>`) : '';
  $('dialog-content').innerHTML = `<h2 id="dialog-title">Handoff pass</h2><p>${favor.name} · ${favor.item}</p>
    <div class="handoff-ticket" data-route="${favor.route}"><div class="ticket-head"><span class="line-mark" aria-hidden="true">${routes[favor.route].code}</span><strong>${stage}</strong><span class="pill ${delivered ? 'good' : ''}">${favor.points} pts ${held ? 'held' : delivered ? 'paid' : 'returned'}</span></div>
    <ol class="ticket-stops"><li><strong>${escapeHtml(pickup)}</strong><span>${pickupWindow}</span></li><li><strong>${escapeHtml(dropoff)}</strong><span>Estimated arrival ${favor.eta}${favor.deadline ? ` · Deliver by ${favor.deadline}` : ''}</span></li></ol></div>
    ${favor.instructions ? `<p class="handoff-instructions"><strong>Instructions</strong>${escapeHtml(favor.instructions)}</p>` : ''}
    <ol class="handoff-steps" aria-label="Handoff progress">${progress}</ol>
    ${journeyChallenge(favor)}
    ${held ? `<p class="pass-note">${awaiting ? 'Switch to the traveler role to accept this offer.' : pickedUp ? 'Confirm that the recipient has received the item.' : 'Mark pickup once the traveler has the item. Cancel before pickup to get your points back.'}</p><div class="pass-actions">${action}</div>` : ''}
    ${cancelled ? '' : `<button type="button" class="text-button copy-pass" data-copy-pass="${favor.id}">Copy handoff details</button>
      <p class="copy-status" id="pass-copy-status" role="status"></p><textarea id="pass-copy-text" aria-label="Handoff details to copy" readonly rows="4" hidden></textarea>`}`;
  showSheet(id);
  if ($('challenge-clock')) {
    updateChallengeClock(favor);
    challengeTimer = setInterval(() => updateChallengeClock(favor), 250);
  }
}

function journeyChallenge(favor) {
  if (!favor.offeredAt || favor.status === 'cancelled') return '';
  if (favor.status === 'delivered') {
    return `<div class="challenge-box"><h3>Traveler reward · ${favor.points + earnedBonus(favor)} pts</h3>
      <p>Estimated ${favor.estimateMinutes} min · Simulated journey ${favor.journeyMinutes} min</p>
      <p>${favor.points} base + ${favor.quickBonus} quick acceptance + ${favor.journeyBonus} early arrival</p></div>`;
  }
  return `<div class="challenge-box"><h3>Traveler challenge</h3><p>Estimated journey <strong>${favor.estimateMinutes} min</strong></p>
    <p>Accept within ${QUICK_ACCEPT_SECONDS}s for <strong>+${QUICK_ACCEPT_POINTS} pts</strong>. Beat the estimate for <strong>+${EARLY_ARRIVAL_POINTS} pts</strong>.</p>
    <p>After pickup, 1 second equals 1 demo journey minute. The demo adds bonuses at delivery without charging the sender extra.</p><p id="challenge-clock"></p></div>`;
}

function updateChallengeClock(favor) {
  const meter = $('challenge-clock');
  if (!meter || !dialog.open) return;
  if (needsAcceptance(favor)) {
    const remaining = Math.max(0, Math.ceil((favor.offeredAt + QUICK_ACCEPT_SECONDS * 1000 - Date.now()) / 1000));
    meter.textContent = remaining ? `${remaining}s left for the quick-accept bonus.` : 'The bonus window ended. You can still accept the offer.';
  } else if (favor.pickedUpAt) {
    meter.textContent = `${elapsedJourney(favor)} of ${favor.estimateMinutes} simulated min elapsed.`;
  } else {
    meter.textContent = quickAcceptBonus(favor) ? `+${QUICK_ACCEPT_POINTS} quick-accept pts pending delivery. The journey clock starts at pickup.` : 'The journey clock starts at pickup.';
  }
}

async function copyHandoff(id) {
  const favor = state.favors.find(entry => entry.id === id && entry.status !== 'cancelled');
  if (!favor) return;
  const status = $('pass-copy-status');
  const [pickup, dropoff] = savedHandoffStops(favor);
  const pickupTime = favor.pickupWindow ? ` (${favor.pickupWindow} HKT)` : '';
  const text = `CarryAlong demo handoff\n${favor.item} with ${favor.name}\nPickup: ${pickup}${pickupTime}\nDrop-off: ${dropoff}\nEstimated arrival: ${favor.eta} HKT${favor.instructions ? `\nInstructions: ${favor.instructions}` : ''}`;
  try {
    await navigator.clipboard.writeText(text);
    if ($('pass-copy-status') === status) status.textContent = 'Handoff details copied.';
  } catch {
    if (!dialog.open || $('pass-copy-status') !== status) return;
    const field = $('pass-copy-text');
    field.value = text;
    field.hidden = false;
    field.focus();
    field.select();
    status.textContent = 'Select and copy the handoff details below.';
  }
}

async function reserveTrip(id) {
  const candidate = evaluated.find(row => row.trip.id === id);
  if (!candidate?.available) return;
  const {trip, points, features} = candidate;
  const item = sizes[request.size];
  const [pickup, dropoff] = handoffStops(candidate);
  const now = Date.now();
  const favor = {id: uniqueId(), tripId: trip.id, name: trip.name, points, item,
    route: trip.route, pickup, dropoff, handoff: `${pickup} → ${dropoff}`, instructions: request.instructions,
    eta: toTime(features.arrival), deadline: toTime(request.end), estimateMinutes: features.ride + features.detour, offeredAt: now,
    pickupWindow: `${toTime(Math.max(request.start, trip.depart - 12))}–${toTime(trip.depart)}`, createdAt: now};
  const reserved = await updateState(() => reserve(state.favors, favor));
  dialog.close();
  if (reserved) {
    switchView('wallet');
    showPass(favor.id);
  } else {
    toast('This trip is already reserved or your balance is too low.');
  }
}

function clearStopHint(event, label, description) {
  const form = event.currentTarget;
  if (form.dataset.startStop && ['route', 'direction', 'node'].includes(event.target.name)) {
    delete form.dataset.startStop;
    $(label).textContent = description;
  }
}

requestForm.addEventListener('input', event => {
  clearStopHint(event, 'request-intro', 'Choose where and when your item needs to go.');
  $('request-error').hidden = true;
  if (['route', 'direction', 'size', 'pickupPin', 'dropoffPin'].includes(event.target.name)) updateRequestExtras();
  const preferred = allTrips().find(trip => trip.id === preferredTripId);
  if (preferred && (preferred.route !== requestForm.elements.route.value || preferred.direction !== requestForm.elements.direction.value)) {
    preferredTripId = undefined;
    $('request-intro').textContent = 'Choose where and when your item needs to go.';
  }
});
$('trip-form').addEventListener('input', event => clearStopHint(event, 'trip-intro', 'Choose your route and carrying limits.'));
requestForm.elements.route.addEventListener('change', drawMap);
requestForm.addEventListener('submit', event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(requestForm));
  const start = fromTime(form.start);
  const end = fromTime(form.end);
  if (end <= start) {
    $('request-error').textContent = 'Choose a delivery deadline later than the ready time on the same day.';
    $('request-error').hidden = false;
    $('request-end').focus();
    return;
  }
  const {pickup, dropoff} = readRequestPins(form);
  if (pickup.error || dropoff.error) {
    $('request-extras').open = true;
    $('request-error').textContent = pickup.error ? `Pickup: ${pickup.error}` : `Drop-off: ${dropoff.error}`;
    $('request-error').hidden = false;
    $(pickup.error ? 'pickup-pin' : 'dropoff-pin').focus();
    return;
  }
  const [campus, station] = form.direction === 'out' ? [pickup, dropoff] : [dropoff, pickup];
  request = {...form, size: +form.size, urgency: +form.urgency, start, end,
    pickupLabel: form.pickupLabel.trim(), dropoffLabel: form.dropoffLabel.trim(), instructions: form.instructions.trim(),
    pickupPin: pickup.pin, dropoffPin: dropoff.pin, campusPinMinutes: campus.minutes, stationPinMinutes: station.minutes};
  renderResults();
  switchScreen('matches');
});

$('trip-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  const trip = {...form, id: uniqueId(), name: 'Your demo trip', posted: true, depart: fromTime(form.depart), limit: +form.limit, space: +form.space};
  if ($('filter-route').value !== 'all') $('filter-route').value = trip.route;
  if ($('filter-direction').value !== 'all') $('filter-direction').value = trip.direction;
  await updateState(() => state.trips.push(trip));
  switchScreen('trips');
  toast('Trip posted and available for matching.');
});

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) {
    const view = button.dataset.view;
    switchView(view, button.dataset.screen || {match: 'home', trips: 'trips'}[view]);
  } else if (button.dataset.screen) switchScreen(button.dataset.screen);
  if (button.dataset.scenario) {
    fillRequest(scenarios[button.dataset.scenario]);
    switchScreen('matches');
  }
  if (button.id === 'extend-window') {
    request.end = Math.min(1439, request.end + 30);
    requestForm.elements.end.value = toTime(request.end);
    renderResults();
    focusScreen($('matches-screen'));
  }
  if (button.dataset.prepTrip) planTrip(button.dataset.prepTrip);
  if (button.dataset.nearby) showNearby(button.dataset.nearby);
  if (button.id === 'locate-device') detectStartingStop();
  if (button.id === 'locate-sample') {
    const status = $('nearby-status');
    status.hidden = false;
    showStopSuggestion(nearestStartingStop({latitude: 22.3159, longitude: 114.2647, accuracy: 20}), status, null, true);
  }
  if (button.dataset.useStop) applyStartingStop(button.dataset.useStop);
  if (button.dataset.explain) explain(evaluated.find(candidate => candidate.trip.id === button.dataset.explain));
  if (button.dataset.review) reviewReservation(evaluated.find(candidate => candidate.trip.id === button.dataset.review));
  if (button.dataset.pass) showPass(button.dataset.pass);
  if (button.dataset.copyPass) await copyHandoff(button.dataset.copyPass);
  if (button.dataset.reserve) {
    button.disabled = true;
    await reserveTrip(button.dataset.reserve);
  }
  if (button.dataset.accept || button.dataset.pickup || button.dataset.settle) {
    button.disabled = true;
    const id = button.dataset.accept || button.dataset.pickup || button.dataset.settle;
    const updated = await updateState(() => {
      if (button.dataset.accept) return acceptOffer(state.favors, id);
      if (button.dataset.pickup) return markPickup(state.favors, id);
      return settle(state.favors, id, button.dataset.status);
    });
    if (dialog.open && openPassId === id) {
      if (state.favors.some(favor => favor.id === id)) showPass(id);
      else dialog.close();
    }
    if (!updated) toast('This handoff has already changed.');
  }
});

dialog.addEventListener('close', () => {
  if (!dialog.open) clearInterval(challengeTimer);
});

$('reset-button').addEventListener('click', () => {
  $('dialog-content').innerHTML = '<h2 id="dialog-title">Reset demo?</h2><p>This clears posted demo trips and favor activity on this browser and restores the opening balance.</p><button id="confirm-reset" class="button primary">Reset demo</button>';
  $('confirm-reset').addEventListener('click', async () => {
    $('filter-route').value = 'all';
    $('filter-direction').value = 'all';
    await updateState(() => { state = {trips: [], favors: []}; });
    $('trip-form').reset();
    delete $('trip-form').dataset.startStop;
    $('trip-intro').textContent = 'Choose your route and carrying limits.';
    $('post-screen').hidden = true;
    $('trips-screen').hidden = false;
    $('eval-split').value = 'test';
    $('eval-route').value = 'all';
    renderBenchmark();
    dialog.close();
    fillRequest(scenarios.standard);
    switchView('match', 'home');
    toast('Demo reset.');
  });
  showSheet();
});

window.addEventListener('storage', event => {
  if (event.key === storageKey) {
    state = loadState() ?? {trips: [], favors: []};
    render();
    if (dialog.open && openPassId) {
      if (state.favors.some(favor => favor.id === openPassId)) showPass(openPassId);
      else dialog.close();
    }
  }
});
$('filter-route').addEventListener('change', renderTrips);
$('filter-direction').addEventListener('change', renderTrips);
$('sort-matches').addEventListener('change', renderResults);
$('eval-split').addEventListener('change', renderBenchmark);
$('eval-route').addEventListener('change', renderBenchmark);
new ResizeObserver(drawMap).observe($('map-canvas').parentElement);
updateRequestExtras();
render();
renderBenchmark();
