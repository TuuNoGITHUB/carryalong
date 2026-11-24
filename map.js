const mapWidgets = new Map();
const pinLabels = {pickup: 'Pickup', dropoff: 'Drop-off'};
const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const mapAttribution = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';
let devicePosition;

function getDevicePosition() {
  if (!navigator.geolocation) return Promise.reject(new Error('This browser cannot access device location.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      const {latitude, longitude, accuracy} = position.coords;
      devicePosition = {latitude, longitude, accuracy};
      for (const widget of mapWidgets.values()) syncLocationMarker(widget);
      resolve(devicePosition);
    }, reject, {maximumAge: 0, timeout: 9000});
  });
}

function mapForm() {
  const {route, direction, pickupPin, dropoffPin} = requestForm.elements;
  return {route: route.value, direction: direction.value, pickupPin: pickupPin.value, dropoffPin: dropoffPin.value};
}

function syncLocationMarker(widget) {
  if (!devicePosition) {
    widget.location.clearLayers();
    return;
  }
  const point = [devicePosition.latitude, devicePosition.longitude];
  if (!widget.location.getLayers().length) {
    L.circle(point, {radius: devicePosition.accuracy, color: '#2c70d5', weight: 1, fillOpacity: .12, interactive: false}).addTo(widget.location);
    L.circleMarker(point, {radius: 7, color: '#fff', weight: 2, fillColor: '#236cd6', fillOpacity: 1, interactive: false}).addTo(widget.location);
    L.marker(point, {icon: L.divIcon({className: 'my-location-label', html: 'You', iconSize: [30, 19], iconAnchor: [-10, 9]}), interactive: false, keyboard: false}).addTo(widget.location);
  } else {
    const [radius, dot, label] = widget.location.getLayers();
    radius.setLatLng(point).setRadius(devicePosition.accuracy);
    dot.setLatLng(point);
    label.setLatLng(point);
  }
}

function fitServiceArea(widget, includeLocation = false) {
  const {route} = mapForm();
  const keys = widget.scope === 'home' ? Object.keys(startingStops) : ['campus', route];
  const points = keys.map(key => [startingStops[key].lat, startingStops[key].lon]);
  for (const marker of Object.values(widget.pins)) if (marker) points.push(marker.getLatLng());
  if (includeLocation && devicePosition && nearestStartingStop(devicePosition).status === 'found') {
    points.push([devicePosition.latitude, devicePosition.longitude]);
  }
  widget.map.fitBounds(points, {padding: [32, 39], maxZoom: 15, animate: false});
}

function setMapStatus(widget, message) {
  widget.panel.querySelector('.map-status').textContent = message;
}

function armPin(widget, kind) {
  widget.armed = kind;
  for (const button of widget.panel.querySelectorAll('[data-map-pin]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mapPin === kind));
  }
  widget.panel.classList.toggle('pin-armed', Boolean(kind));
  if (kind) {
    const {anchors} = readRequestPins(mapForm());
    const target = widget.scope === 'home' ? 'near HKUST North Gate or a supported MTR station' : `near ${anchors[kind === 'pickup' ? 0 : 1].name}`;
    setMapStatus(widget, `Tap ${target} to place the ${pinLabels[kind].toLowerCase()} pin. On a keyboard, pan and press Enter.`);
  } else setMapStatus(widget, 'Choose pickup or drop-off, then tap the map.');
}

function placePin(widget, kind, point, refocus = false) {
  const value = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  const form = mapForm();
  const pickup = kind === 'pickup';
  const {anchors} = readRequestPins(form);
  let route = form.route;
  let direction = form.direction;

  if (widget.scope === 'home') {
    const nearest = nearestStartingStop({latitude: point.lat, longitude: point.lng, accuracy: 0});
    if (nearest.status !== 'found') {
      setMapStatus(widget, 'Choose a point within 1.2 km of HKUST North Gate, Hang Hau or Choi Hung.');
      return false;
    }
    const onCampus = nearest.key === 'campus';
    direction = pickup === onCampus ? 'out' : 'in';
    if (!onCampus) route = nearest.key;
    const otherValue = pickup ? form.dropoffPin : form.pickupPin;
    const otherAnchor = onCampus ? startingStops[route] : startingStops.campus;
    if (estimatePinWalk(otherValue, otherAnchor).error) {
      setMapStatus(widget, 'Keep one pin near HKUST and one near an MTR stop. Clear the other pin to change the route.');
      return false;
    }
  } else {
    const pin = estimatePinWalk(value, anchors[pickup ? 0 : 1]);
    if (pin.error) {
      setMapStatus(widget, pin.error);
      return false;
    }
  }

  const {route: routeField, direction: directionField} = requestForm.elements;
  routeField.value = route;
  directionField.value = direction;
  requestForm.elements[`${kind}Pin`].value = value;
  requestForm.elements[`${kind}Pin`].dispatchEvent(new Event('input', {bubbles: true}));
  if (route !== form.route || direction !== form.direction) directionField.dispatchEvent(new Event('input', {bubbles: true}));
  armPin(widget, null);
  setMapStatus(widget, `${pinLabels[kind]} pin set. Drag it to adjust.`);
  if (refocus) widget.panel.querySelector(`[data-map-pin="${kind}"]`).focus({preventScroll: true});
  return true;
}

function refreshPins(widget, pinDetails) {
  const rows = [];
  for (const kind of Object.keys(pinLabels)) {
    const pin = pinDetails[kind];
    const marker = widget.pins[kind];
    if (!pin.pin) {
      if (marker) marker.remove();
      delete widget.pins[kind];
      if (pin.error) rows.push(`<li><span><strong>${pinLabels[kind]}</strong> Check this pin for the selected route.</span><button type="button" class="text-button" data-map-clear="${kind}" aria-label="Clear ${pinLabels[kind].toLowerCase()} pin">Clear</button></li>`);
      continue;
    }
    const coordinates = pin.pin.split(',').map(Number);
    if (marker) marker.setLatLng(coordinates);
    else {
      const icon = L.divIcon({className: `placed-pin ${kind}`, html: pinLabels[kind][0], iconSize: [26, 26], iconAnchor: [13, 13]});
      widget.pins[kind] = L.marker(coordinates, {icon, title: `${pinLabels[kind]} pin`, alt: `${pinLabels[kind]} pin`, draggable: true, autoPan: true})
        .addTo(widget.map).on('dragend', event => {
          if (!placePin(widget, kind, event.target.getLatLng())) refreshPins(widget, readRequestPins(mapForm()));
        });
    }
    rows.push(`<li><span><strong>${pinLabels[kind]}</strong> <span>${pin.pin}</span></span><button type="button" class="text-button" data-map-clear="${kind}" aria-label="Clear ${pinLabels[kind].toLowerCase()} pin">Clear</button></li>`);
  }
  const list = widget.panel.querySelector('.map-pin-list');
  const html = rows.join('');
  if (list.dataset.rendered !== html) {
    list.innerHTML = html;
    list.dataset.rendered = html;
  }
  list.hidden = !rows.length;
  widget.panel.querySelector('.map-continue').hidden = widget.scope !== 'home' || !Object.values(widget.pins).length;
}

function createHandoffMap(panel) {
  panel.append($('handoff-map-template').content.cloneNode(true));
  const viewport = panel.querySelector('.street-map');
  const map = L.map(viewport, {center: [22.330, 114.242], zoom: 13, minZoom: 3, maxZoom: 19, scrollWheelZoom: false, zoomAnimation: false, doubleClickZoom: false});
  map.attributionControl.setPrefix(false).addAttribution(mapAttribution);
  const widget = {panel, map, viewport, scope: panel.dataset.handoffMap, pins: {}, location: L.layerGroup().addTo(map)};
  mapWidgets.set(panel, widget);

  const tileStatus = panel.querySelector('.map-tiles-status');
  if (location.protocol === 'https:' || location.protocol === 'http:') {
    const tiles = L.tileLayer(tileUrl, {maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin'});
    tiles.on('tileerror', () => {
      tileStatus.textContent = 'Some street map tiles are unavailable. You can still use the stop markers and pins.';
      tileStatus.hidden = false;
    }).on('tileload', () => { tileStatus.hidden = true; }).addTo(map);
  } else {
    tileStatus.textContent = 'Open the hosted demo for the street map. Stop markers, pin placement and coordinate entry still work here.';
    tileStatus.hidden = false;
  }

  for (const stop of Object.values(startingStops)) {
    const icon = L.divIcon({className: 'map-stop-icon', html: stop.code, iconSize: [29, 21], iconAnchor: [14, 10]});
    L.marker([stop.lat, stop.lon], {icon, title: stop.name, alt: stop.name}).addTo(map).bindTooltip(stop.name, {direction: 'top', offset: [0, -10]})
      .on('click', event => { if (widget.armed) placePin(widget, widget.armed, event.target.getLatLng()); });
  }
  map.on('click', event => { if (widget.armed) placePin(widget, widget.armed, event.latlng); });
  viewport.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target === viewport && widget.armed) {
      event.preventDefault();
      placePin(widget, widget.armed, map.getCenter(), true);
    }
  });
  panel.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.mapPin) armPin(widget, widget.armed === button.dataset.mapPin ? null : button.dataset.mapPin);
    if (button.dataset.mapClear) {
      const kind = button.dataset.mapClear;
      const field = requestForm.elements[`${kind}Pin`];
      field.value = '';
      field.dispatchEvent(new Event('input', {bubbles: true}));
      setMapStatus(widget, `${pinLabels[kind]} pin cleared.`);
      panel.querySelector(`[data-map-pin="${kind}"]`).focus({preventScroll: true});
    }
    if (button.dataset.mapAction === 'fit') fitServiceArea(widget);
    if (button.dataset.mapAction === 'request') switchView('match', 'request');
    if (button.dataset.mapAction === 'locate') {
      button.disabled = true;
      setMapStatus(widget, 'Waiting for device location…');
      try {
        const position = await getDevicePosition();
        if (!panel.closest('[hidden]')) map.setView([position.latitude, position.longitude], position.accuracy > 1000 ? 13 : 16, {animate: false});
        const qualifier = nearestStartingStop(position).status === 'outside' ? ' Your position is outside the demo service area.' : '';
        setMapStatus(widget, `Your location is the blue marker (accuracy about ${Math.round(position.accuracy)} m).${qualifier}`);
      } catch (error) {
        setMapStatus(widget, error.code === 1 ? 'Location access was declined or blocked. You can still set pins on the map.' : 'Device location is unavailable. You can still set pins on the map.');
      } finally {
        button.disabled = false;
      }
    }
  });
  new ResizeObserver(() => { if (viewport.clientWidth) map.invalidateSize({pan: false}); }).observe(viewport);
  armPin(widget, null);
  return widget;
}

function syncHandoffMaps(fit = false) {
  const pins = readRequestPins(mapForm());
  for (const panel of document.querySelectorAll('[data-handoff-map]')) {
    if (panel.closest('[hidden]')) continue;
    const existing = mapWidgets.get(panel);
    const widget = existing ?? createHandoffMap(panel);
    widget.map.invalidateSize({pan: false});
    refreshPins(widget, pins);
    syncLocationMarker(widget);
    if (!existing || fit) fitServiceArea(widget, true);
  }
}

function resetHandoffMaps() {
  devicePosition = undefined;
  for (const widget of mapWidgets.values()) {
    syncLocationMarker(widget);
    armPin(widget, null);
  }
}
