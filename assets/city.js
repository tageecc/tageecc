const stage = document.getElementById('city-stage');
const host = document.getElementById('canvas-host');
const fallback = document.getElementById('fallback');
const status = document.getElementById('load-status');
const tooltip = document.getElementById('tooltip');
const daySelect = document.getElementById('day-select');
const dailyDetails = daySelect.closest('details');
const rotationButton = document.getElementById('toggle-rotation');
const number = new Intl.NumberFormat('en-US');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const colors = ['#2d333b', '#065f46', '#059669', '#10b981', '#34d399'];
const svgNS = 'http://www.w3.org/2000/svg';
const unit = 13;
const size = unit - 1.8;
const faces = [
  { indices: [4, 5, 6, 7], scale: 1, normal: [0, 0, 1] },
  { indices: [3, 2, 1, 0], scale: 0.4, normal: [0, 0, -1] },
  { indices: [3, 0, 4, 7], scale: 0.55, normal: [-1, 0, 0] },
  { indices: [1, 2, 6, 5], scale: 0.75, normal: [1, 0, 0] },
  { indices: [0, 1, 5, 4], scale: 0.85, normal: [0, -1, 0] },
  { indices: [2, 3, 7, 6], scale: 0.65, normal: [0, 1, 0] },
];

function rotatePoint(x, y, z, yaw, pitch) {
  const x1 = x * Math.cos(yaw) - y * Math.sin(yaw);
  const y1 = x * Math.sin(yaw) + y * Math.cos(yaw);
  return { x: x1, y: y1 * Math.cos(pitch) - z * Math.sin(pitch), z: y1 * Math.sin(pitch) + z * Math.cos(pitch) };
}

function shadeColor(hex, factor) {
  const value = parseInt(hex.slice(1), 16);
  const channel = shift => Math.min(255, Math.max(0, Math.round(((value >> shift) & 255) * factor)));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function element(name, attributes = {}) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function validateCalendar(data) {
  if (!data || typeof data.username !== 'string' || !Number.isSafeInteger(data.totalContributions) || data.totalContributions < 0 || !Array.isArray(data.weeks) || !data.weeks.length || data.weeks.length > 54) throw new Error('Invalid calendar');
  const seen = new Set();
  for (const week of data.weeks) {
    if (!Array.isArray(week.contributionDays) || !week.contributionDays.length || week.contributionDays.length > 7) throw new Error('Invalid week');
    for (const day of week.contributionDays) {
      const parsed = new Date(`${day.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day.date || seen.has(day.date) || !Number.isSafeInteger(day.contributionCount) || day.contributionCount < 0) throw new Error('Invalid day');
      seen.add(day.date);
    }
  }
  return data;
}

function showFallback(message) {
  host.hidden = true;
  fallback.hidden = false;
  tooltip.hidden = true;
  status.hidden = false;
  status.textContent = `${message} The static preview is shown. Reload to try again.`;
}

async function start() {
  let data;
  try {
    const response = await fetch('./assets/contributions.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = validateCalendar(await response.json());
  } catch {
    showFallback('Contribution data could not load.');
    return;
  }
  const days = data.weeks.flatMap((week, index) => week.contributionDays.map(day => {
    const count = day.contributionCount;
    return { ...day, week: index, weekday: new Date(`${day.date}T00:00:00Z`).getUTCDay(), level: count === 0 ? 0 : count <= 10 ? 1 : count <= 40 ? 2 : count <= 120 ? 3 : 4 };
  }));
  document.getElementById('activity-total').textContent = `${number.format(data.totalContributions)} contributions · ${days.filter(day => day.contributionCount > 0).length} active days`;
  daySelect.replaceChildren(...days.map(day => new Option(`${day.date} · ${number.format(day.contributionCount)}`, day.date)));
  daySelect.disabled = false;
  daySelect.value = days.at(-1).date;

  const svg = element('svg', { role: 'img', 'aria-label': 'Interactive 3D contribution heatmap', 'aria-describedby': 'keyboard-help', tabindex: '0', preserveAspectRatio: 'xMidYMid meet' });
  const grid = element('g', { fill: 'none', stroke: '#34d399', 'stroke-opacity': '0.08', 'stroke-width': '0.25', 'stroke-dasharray': '1.5 2.5', 'pointer-events': 'none' });
  const voxels = element('g');
  svg.append(grid, voxels);
  host.append(svg);
  for (const day of days) {
    day.node = element('g', { 'data-date': day.date, 'data-count': day.contributionCount });
    day.paths = faces.map(() => element('path', { 'stroke-width': '0.25', 'stroke-linejoin': 'round' }));
    day.node.append(...day.paths);
    voxels.append(day.node);
  }
  const gridLines = [];
  for (let row = 0; row <= 7; row++) gridLines.push([[-data.weeks.length / 2 * unit, (row - 3.5) * unit, 0], [data.weeks.length / 2 * unit, (row - 3.5) * unit, 0]]);
  for (let column = 0; column <= data.weeks.length; column += 4) gridLines.push([[(column - data.weeks.length / 2) * unit, -3.5 * unit, 0], [(column - data.weeks.length / 2) * unit, 3.5 * unit, 0]]);
  for (const points of gridLines) {
    points.node = element('path');
    grid.append(points.node);
  }
  let yaw = -0.2, pitch = 0.88, zoom = 1, growth = reducedMotion.matches ? 1 : 0;
  let frame, inertia, growthFrame, selected;
  let rotationFrame, rotationTimer, lastRotationTime;
  let rotationEnabled = !reducedMotion.matches, inView = false;
  let velocity = { x: 0, y: 0 };
  let lastMove;
  const pointers = new Map();
  let gesture, multiTouch = false, dragged = false;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  function draw() {
    frame = undefined;
    const projected = days.map(day => {
      const x = (day.week - data.weeks.length / 2) * unit;
      const y = (day.weekday - 3.5) * unit;
      const targetHeight = Math.max(1.8, day.level / 4 * 38);
      const distance = Math.hypot(day.week - data.weeks.length / 2, day.weekday - 3.5);
      const delay = distance / Math.hypot(data.weeks.length / 2, 3.5) * 0.4;
      const height = targetHeight * clamp((growth - delay) / 0.6, 0, 1);
      const half = size / 2;
      const vertices = [[x - half, y - half, 0], [x + half, y - half, 0], [x + half, y + half, 0], [x - half, y + half, 0], [x - half, y - half, height], [x + half, y - half, height], [x + half, y + half, height], [x - half, y + half, height]].map(point => rotatePoint(...point, yaw, pitch));
      faces.forEach((face, index) => {
        const normal = rotatePoint(...face.normal, yaw, pitch);
        const path = day.paths[index];
        path.hidden = normal.z <= 0.001;
        path.style.display = normal.z > 0.001 ? '' : 'none';
        if (normal.z <= 0.001) return;
        const factor = face.scale * (0.82 + 0.28 * Math.max(0, normal.x * 0.35 - normal.y * 0.4 + normal.z * 0.83)) + 0.18;
        const fill = shadeColor(colors[day.level], factor);
        path.setAttribute('d', face.indices.map((vertex, i) => `${i ? 'L' : 'M'}${vertices[vertex].x.toFixed(3)},${vertices[vertex].y.toFixed(3)}`).join(' ') + ' Z');
        path.setAttribute('fill', fill);
        path.setAttribute('stroke', fill);
      });
      return { day, vertices, depth: rotatePoint(x, y, height / 2, yaw, pitch).z };
    });
    projected.sort((a, b) => a.depth - b.depth);
    voxels.replaceChildren(...projected.map(item => item.day.node));
    const allPoints = projected.flatMap(item => item.vertices);
    for (const points of gridLines) {
      const projectedLine = points.map(point => rotatePoint(...point, yaw, pitch));
      points.node.setAttribute('d', `M${projectedLine[0].x},${projectedLine[0].y} L${projectedLine[1].x},${projectedLine[1].y}`);
      allPoints.push(...projectedLine);
    }
    const minX = Math.min(...allPoints.map(point => point.x)) - 22;
    const maxX = Math.max(...allPoints.map(point => point.x)) + 22;
    const minY = Math.min(...allPoints.map(point => point.y)) - 22;
    const maxY = Math.max(...allPoints.map(point => point.y)) + 22;
    const width = (maxX - minX) / zoom, height = (maxY - minY) / zoom;
    svg.setAttribute('viewBox', `${(minX + maxX - width) / 2} ${(minY + maxY - height) / 2} ${width} ${height}`);
  }
  function requestDraw() { if (frame === undefined && !host.hidden) frame = requestAnimationFrame(draw); }
  function stopRotation() {
    if (rotationFrame !== undefined) cancelAnimationFrame(rotationFrame);
    clearTimeout(rotationTimer);
    rotationFrame = undefined;
    rotationTimer = undefined;
    lastRotationTime = undefined;
  }
  function canRotate() {
    return rotationEnabled && !reducedMotion.matches && !document.hidden && inView && !host.hidden && !pointers.size && inertia === undefined && growthFrame === undefined && !selected && !dailyDetails.open && !svg.matches(':focus-visible');
  }
  function resumeRotation(delay = 5000) {
    stopRotation();
    if (!canRotate()) return;
    if (delay) { rotationTimer = setTimeout(() => resumeRotation(0), delay); return; }
    const tick = now => {
      if (!canRotate()) { stopRotation(); return; }
      if (lastRotationTime === undefined) lastRotationTime = now;
      const elapsed = now - lastRotationTime;
      if (elapsed >= 1000 / 30) {
        yaw -= Math.min(elapsed, 100) * 0.000045;
        lastRotationTime = now;
        requestDraw();
      }
      rotationFrame = requestAnimationFrame(tick);
    };
    rotationFrame = requestAnimationFrame(tick);
  }
  function updateRotationButton() {
    rotationButton.disabled = reducedMotion.matches;
    rotationButton.setAttribute('aria-pressed', String(rotationEnabled));
    rotationButton.textContent = reducedMotion.matches ? 'Auto-rotation off' : rotationEnabled ? 'Pause rotation' : 'Resume rotation';
    rotationButton.title = reducedMotion.matches ? 'Auto-rotation is off because reduced motion is enabled.' : 'Auto-rotation pauses while inspecting or interacting.';
  }
  function clearInertia() {
    if (inertia !== undefined) cancelAnimationFrame(inertia);
    inertia = undefined;
    velocity = { x: 0, y: 0 };
  }
  function reset() {
    clearInertia();
    yaw = host.clientWidth < host.clientHeight ? -0.95 : -0.2;
    pitch = 0.88;
    zoom = 1;
    hideTooltip();
    requestDraw();
  }
  function hideTooltip() {
    tooltip.hidden = true;
    selected?.node.classList.remove('is-hovered');
    selected = undefined;
    resumeRotation();
  }
  function inspect(event) {
    const node = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-date]');
    const day = days.find(item => item.node === node);
    if (!day) { hideTooltip(); return; }
    selected?.node.classList.remove('is-hovered');
    selected = day;
    stopRotation();
    clearInertia();
    day.node.classList.add('is-hovered');
    document.getElementById('tooltip-date').textContent = day.date;
    document.getElementById('tooltip-count').textContent = `${number.format(day.contributionCount)} ${day.contributionCount === 1 ? 'contribution' : 'contributions'}`;
    tooltip.hidden = false;
    const rect = stage.getBoundingClientRect();
    tooltip.style.left = `${clamp(event.clientX - rect.left + 14, 8, rect.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${clamp(event.clientY - rect.top - tooltip.offsetHeight - 14, 8, rect.height - tooltip.offsetHeight - 8)}px`;
  }
  function startGesture() {
    const points = [...pointers.values()];
    gesture = { points: points.map(point => ({ ...point })), yaw, pitch, zoom, distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0 };
  }
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    clearInertia();
    hideTooltip();
    if (!pointers.size) { dragged = false; multiTouch = false; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) multiTouch = true;
    svg.setPointerCapture(event.pointerId);
    lastMove = { x: event.clientX, y: event.clientY, time: performance.now() };
    stopRotation();
    startGesture();
  });
  svg.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse') inspect(event); return; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.values()];
    const dx = points[0].x - gesture.points[0].x, dy = points[0].y - gesture.points[0].y;
    if (Math.hypot(dx, dy) > 5) dragged = true;
    if (points.length > 1) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      zoom = clamp(gesture.zoom * distance / Math.max(1, gesture.distance), 0.5, 3);
    } else {
      yaw = gesture.yaw - dx * 0.005;
      pitch = clamp(gesture.pitch - dy * 0.005, 0.18, Math.PI / 2.3);
      const now = performance.now(), elapsed = now - lastMove.time;
      if (elapsed > 0) velocity = { x: clamp((event.clientX - lastMove.x) / elapsed, -1, 1), y: clamp((event.clientY - lastMove.y) / elapsed, -1, 1) };
      lastMove = { x: event.clientX, y: event.clientY, time: now };
    }
    hideTooltip();
    requestDraw();
  });
  function finishGesture(event, cancelled = false) {
    if (!pointers.has(event.pointerId)) return;
    const wasMultiTouch = multiTouch;
    pointers.delete(event.pointerId);
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (pointers.size) { startGesture(); return; }
    if (!cancelled && !wasMultiTouch && !dragged) inspect(event);
    if (!cancelled && !wasMultiTouch && dragged && !reducedMotion.matches && performance.now() - lastMove.time < 100) {
      let speedX = -velocity.x * 12, speedY = -velocity.y * 12;
      const tick = () => {
        speedX *= 0.92; speedY *= 0.92;
        if (Math.abs(speedX) < 0.01 && Math.abs(speedY) < 0.01) { inertia = undefined; resumeRotation(); return; }
        yaw += speedX * 0.005;
        pitch = clamp(pitch + speedY * 0.005, 0.18, Math.PI / 2.3);
        requestDraw();
        inertia = requestAnimationFrame(tick);
      };
      inertia = requestAnimationFrame(tick);
    }
    multiTouch = false;
    resumeRotation();
  }
  svg.addEventListener('pointerup', event => finishGesture(event));
  svg.addEventListener('pointercancel', event => finishGesture(event, true));
  svg.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !pointers.size) hideTooltip(); });
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    clearInertia();
    zoom = clamp(zoom * Math.exp(-event.deltaY * 0.0025), 0.5, 3);
    hideTooltip();
    requestDraw();
  }, { passive: false });
  svg.addEventListener('dblclick', reset);
  svg.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(event.key)) return;
    event.preventDefault();
    clearInertia();
    if (event.key === 'Home') { reset(); return; }
    if (event.key === 'ArrowLeft') yaw += 0.12;
    if (event.key === 'ArrowRight') yaw -= 0.12;
    if (event.key === 'ArrowUp') pitch = clamp(pitch + 0.1, 0.18, Math.PI / 2.3);
    if (event.key === 'ArrowDown') pitch = clamp(pitch - 0.1, 0.18, Math.PI / 2.3);
    if (['+', '=', '-', '_'].includes(event.key)) zoom = clamp(zoom * (['+', '='].includes(event.key) ? 1.15 : 1 / 1.15), 0.5, 3);
    hideTooltip();
    requestDraw();
  });
  daySelect.addEventListener('change', () => {
    hideTooltip();
    selected = days.find(day => day.date === daySelect.value);
    selected.node.classList.add('is-hovered');
    document.getElementById('selected-day').textContent = `${selected.date}: ${number.format(selected.contributionCount)} contributions`;
  });
  svg.addEventListener('focus', () => { if (svg.matches(':focus-visible')) stopRotation(); });
  svg.addEventListener('blur', () => resumeRotation());
  dailyDetails.addEventListener('toggle', () => {
    if (dailyDetails.open) { stopRotation(); clearInertia(); }
    else hideTooltip();
  });
  rotationButton.addEventListener('click', () => {
    rotationEnabled = !rotationEnabled;
    updateRotationButton();
    resumeRotation(0);
  });
  new ResizeObserver(reset).observe(host);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) { requestDraw(); resumeRotation(); }
    else {
      stopRotation();
      clearInertia();
      if (growthFrame !== undefined) cancelAnimationFrame(growthFrame);
      growthFrame = undefined;
      growth = 1;
    }
  }).observe(stage);
  reducedMotion.addEventListener('change', () => {
    clearInertia();
    if (growthFrame !== undefined) cancelAnimationFrame(growthFrame);
    growthFrame = undefined;
    growth = 1;
    rotationEnabled = !reducedMotion.matches;
    updateRotationButton();
    resumeRotation();
    requestDraw();
  });
  function grow() {
    stopRotation();
    if (growthFrame !== undefined) cancelAnimationFrame(growthFrame);
    growthFrame = undefined;
    if (reducedMotion.matches || document.hidden) { growth = 1; requestDraw(); return; }
    growth = 0;
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / 1200);
      growth = 1 - (1 - progress) ** 3;
      requestDraw();
      if (progress < 1) growthFrame = requestAnimationFrame(tick);
      else { growthFrame = undefined; resumeRotation(); }
    };
    growthFrame = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRotation();
      clearInertia();
      if (growthFrame !== undefined) cancelAnimationFrame(growthFrame);
      growthFrame = undefined;
      growth = 1;
    } else { requestDraw(); resumeRotation(); }
  });
  document.getElementById('reset-view').addEventListener('click', () => { reset(); grow(); });
  fallback.hidden = true;
  status.hidden = true;
  stage.dataset.ready = 'true';
  updateRotationButton();
  reset();
  grow();
  draw();
}

start().catch(() => showFallback('The interactive heatmap could not start.'));
