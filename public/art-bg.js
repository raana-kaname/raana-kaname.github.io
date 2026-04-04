const layer = document.getElementById("mist-layer");

if (layer) {
  const BASE_RGB = [119, 221, 119];
  const TOTAL_COUNT = 8;
  const CORNER_COUNT = 2;
  const RANDOM_COUNT = TOTAL_COUNT - CORNER_COUNT;
  const SIZE_MIN = 80;
  const SIZE_MAX = 96;

  // Lower bound of distribution uniformity. Larger value enforces more even spacing.
  const UNIFORMITY_FLOOR = 0.76;
  const CANDIDATE_ATTEMPTS = 220;
  const EDGE_TARGET_COUNT = 2;
  const EDGE_BAND_WIDTH = 10;
  const FIELD_MIN = 4;
  const FIELD_MAX = 96;
  const CORNER_OFFSET_MAX = 6.0;

  const guaranteedDiagonalIsTopLeftBottomRight = Math.random() < 0.5;
  const guaranteedCorners = guaranteedDiagonalIsTopLeftBottomRight
    ? [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]
    : [
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ];
  const EXCLUDED_CORNERS = guaranteedDiagonalIsTopLeftBottomRight
    ? [
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]
    : [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ];
  const EXCLUDED_CORNER_RADIUS = 16;
  const points = [];
  let planeSide = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;

  const randomInRange = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const updatePlaneBounds = () => {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    const maxViewportDimension = Math.max(viewportWidth, viewportHeight);
    planeSide = maxViewportDimension * 1.2;

    layer.style.inset = "auto";
    layer.style.width = String(planeSide) + "px";
    layer.style.height = String(planeSide) + "px";
    layer.style.left = String((viewportWidth - planeSide) * 0.5) + "px";
    layer.style.top = String((viewportHeight - planeSide) * 0.5) + "px";
  };

  updatePlaneBounds();

  const sizeWeight = (size) => (size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN);

  const targetSpacing =
    ((FIELD_MAX - FIELD_MIN) / Math.sqrt(Math.max(TOTAL_COUNT, 1))) * 0.95;

  const adaptiveMinDistance = (sizeA, sizeB) => {
    const mixedWeight = (sizeWeight(sizeA) + sizeWeight(sizeB)) * 0.5;
    return targetSpacing * UNIFORMITY_FLOOR * (0.9 + mixedWeight * 0.2);
  };

  const adaptiveMaxDistance = (sizeA, sizeB) => {
    const mixedWeight = (sizeWeight(sizeA) + sizeWeight(sizeB)) * 0.5;
    return targetSpacing * 1.65 * (0.92 + mixedWeight * 0.16);
  };

  const nearestPointInfo = (x, y) => {
    if (points.length === 0) {
      return {
        d1: Number.POSITIVE_INFINITY,
        d2: Number.POSITIVE_INFINITY,
        p1: null,
      };
    }

    let nearestPoint = points[0];
    let nearestDistance = Math.hypot(x - nearestPoint.x, y - nearestPoint.y);
    let secondNearestDistance = Number.POSITIVE_INFINITY;

    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < nearestDistance) {
        secondNearestDistance = nearestDistance;
        nearestDistance = d;
        nearestPoint = p;
      } else if (d < secondNearestDistance) {
        secondNearestDistance = d;
      }
    }

    return { d1: nearestDistance, d2: secondNearestDistance, p1: nearestPoint };
  };

  const inExcludedCorner = (x, y) => {
    for (let i = 0; i < EXCLUDED_CORNERS.length; i += 1) {
      const c = EXCLUDED_CORNERS[i];
      if (Math.hypot(x - c.x, y - c.y) < EXCLUDED_CORNER_RADIUS) {
        return true;
      }
    }
    return false;
  };

  const edgeDistance = (x, y) => Math.min(x, 100 - x, y, 100 - y);

  const randomCandidate = (preferEdge) => {
    if (!preferEdge) {
      return {
        x: randomInRange(FIELD_MIN, FIELD_MAX),
        y: randomInRange(FIELD_MIN, FIELD_MAX),
      };
    }

    const side = Math.floor(randomInRange(0, 4));
    const axis = randomInRange(FIELD_MIN, FIELD_MAX);
    const band = randomInRange(0, EDGE_BAND_WIDTH);

    if (side === 0) {
      return { x: axis, y: FIELD_MIN + band };
    }
    if (side === 1) {
      return { x: FIELD_MAX - band, y: axis };
    }
    if (side === 2) {
      return { x: axis, y: FIELD_MAX - band };
    }
    return { x: FIELD_MIN + band, y: axis };
  };

  const cornerPointFromEndpoint = (endpoint) => {
    const inwardAngle = Math.atan2(50 - endpoint.y, 50 - endpoint.x);
    const angle = inwardAngle + randomInRange(-Math.PI / 5, Math.PI / 5);
    const radius = randomInRange(0, CORNER_OFFSET_MAX);
    return {
      x: clamp(endpoint.x + Math.cos(angle) * radius, 0, 100),
      y: clamp(endpoint.y + Math.sin(angle) * radius, 0, 100),
    };
  };

  const pickDistributedPoint = (size, preferEdge) => {
    let bestCandidate = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt += 1) {
      const candidate = randomCandidate(preferEdge);

      if (inExcludedCorner(candidate.x, candidate.y)) {
        continue;
      }

      const near = nearestPointInfo(candidate.x, candidate.y);
      if (!near.p1) {
        return candidate;
      }

      const minDist = adaptiveMinDistance(size, near.p1.size);
      const maxDist = adaptiveMaxDistance(size, near.p1.size);
      if (near.d1 < minDist || near.d1 > maxDist) {
        continue;
      }

      const d2 = Number.isFinite(near.d2) ? near.d2 : targetSpacing;
      let score =
        Math.abs(near.d1 - targetSpacing) +
        0.65 * Math.abs(d2 - targetSpacing) +
        0.5 * Math.abs(d2 - near.d1);

      if (preferEdge) {
        score += edgeDistance(candidate.x, candidate.y) * 0.12;
      }

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    // Risk note: when constraints are too strict for small N and large elements,
    // we relax to a bounded fallback point to avoid generation deadlocks.
    if (!bestCandidate) {
      return {
        x: randomInRange(FIELD_MIN + 4, FIELD_MAX - 4),
        y: randomInRange(FIELD_MIN + 4, FIELD_MAX - 4),
      };
    }

    return bestCandidate;
  };

  const addGlow = (config) => {
    const glow = document.createElement("i");
    glow.className = "glow";

    glow.style.setProperty(
      "--rgb",
      String(BASE_RGB[0]) +
        ", " +
        String(BASE_RGB[1]) +
        ", " +
        String(BASE_RGB[2]),
    );
    glow.style.setProperty("--x", String(config.x) + "%");
    glow.style.setProperty("--y", String(config.y) + "%");
    glow.style.setProperty("--size", String(config.size) + "vmax");
    glow.style.setProperty("--ratio", String(config.ratio));
    glow.style.setProperty("--blur", String(config.blur) + "px");
    glow.style.setProperty("--opacity", String(config.opacity));

    layer.appendChild(glow);
    points.push({ x: config.x, y: config.y, size: config.size });
  };

  for (let i = 0; i < CORNER_COUNT; i += 1) {
    const corner = cornerPointFromEndpoint(guaranteedCorners[i]);
    const size = randomInRange(58, 66);
    const sizeMix = sizeWeight(size);

    addGlow({
      x: corner.x,
      y: corner.y,
      size,
      ratio: randomInRange(0.96, 1.12),
      blur: randomInRange(96, 112),
      opacity: clamp(0.7 + sizeMix * 0.18, 0.68, 0.88),
    });
  }

  const edgeCount = Math.min(EDGE_TARGET_COUNT, RANDOM_COUNT);
  for (let i = 0; i < edgeCount; i += 1) {
    const size = randomInRange(SIZE_MIN, SIZE_MAX);
    const sizeMix = sizeWeight(size);
    const candidate = pickDistributedPoint(size, true);

    addGlow({
      x: candidate.x,
      y: candidate.y,
      size,
      ratio: randomInRange(0.96, 1.12),
      blur: randomInRange(96, 112),
      opacity: clamp(0.55 + sizeMix * 0.2 + randomInRange(0, 0.04), 0.52, 0.82),
    });
  }

  for (let i = edgeCount; i < RANDOM_COUNT; i += 1) {
    const size = randomInRange(SIZE_MIN, SIZE_MAX);
    const sizeMix = sizeWeight(size);
    const bestCandidate = pickDistributedPoint(size, false);

    addGlow({
      x: bestCandidate.x,
      y: bestCandidate.y,
      size,
      ratio: randomInRange(0.96, 1.12),
      blur: randomInRange(96, 112),
      opacity: clamp(0.55 + sizeMix * 0.2 + randomInRange(0, 0.04), 0.52, 0.82),
    });
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (!prefersReducedMotion) {
    // Regression period constants (safe to tune): larger values => slower return cycle.
    const REGRESSION_PERIOD_MIN_MS = 18000;
    const REGRESSION_PERIOD_MAX_MS = 26000;

    const startAngle = randomInRange(0, Math.PI * 2);
    const cycleMs = randomInRange(
      REGRESSION_PERIOD_MIN_MS,
      REGRESSION_PERIOD_MAX_MS,
    );
    const accelMs = 5200;
    const directionShiftMinMs = 5200;
    const directionShiftMaxMs = 8200;
    const directionJitterRad = 0.055;
    const noiseShiftMinMs = 2600;
    const noiseShiftMaxMs = 4600;
    const harmonic2 = randomInRange(0.16, 0.24);
    const harmonic3 = randomInRange(0.06, 0.12);
    const entropyPhaseA = randomInRange(0, Math.PI * 2);
    const entropyPhaseB = randomInRange(0, Math.PI * 2);
    const globalSpeedScale = 0.52;

    let angle = startAngle;
    let targetAngle = startAngle;
    let angleVelocity = 0;
    let noiseValue = 0;
    let noiseTarget = 0;

    let lastFrame = performance.now();
    const startAt = lastFrame;
    let nextDirectionShiftAt =
      startAt +
      accelMs +
      randomInRange(directionShiftMinMs, directionShiftMaxMs);
    let nextNoiseShiftAt =
      startAt + randomInRange(noiseShiftMinMs, noiseShiftMaxMs);
    const breathPhase = randomInRange(0, Math.PI * 2);

    let baseAmplitude = 0;

    const recomputeAmplitude = () => {
      const margin = Math.max(
        24,
        (planeSide - Math.min(viewportWidth, viewportHeight)) * 0.5,
      );
      baseAmplitude = margin * randomInRange(0.72, 0.86);
    };

    recomputeAmplitude();

    const shortestAngleDiff = (a, b) => {
      return Math.atan2(Math.sin(b - a), Math.cos(b - a));
    };

    const smoothstep = (t) => t * t * (3 - 2 * t);

    const tick = (now) => {
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      if (now >= nextDirectionShiftAt) {
        targetAngle += randomInRange(-directionJitterRad, directionJitterRad);
        nextDirectionShiftAt =
          now + randomInRange(directionShiftMinMs, directionShiftMaxMs);
      }

      if (now >= nextNoiseShiftAt) {
        noiseTarget = randomInRange(-0.06, 0.06);
        nextNoiseShiftAt =
          now + randomInRange(noiseShiftMinMs, noiseShiftMaxMs);
      }

      const launchT = clamp((now - startAt) / accelMs, 0, 1);
      const launchFactor = smoothstep(launchT);

      const angleDelta = shortestAngleDiff(angle, targetAngle);
      // Lower response and softer damping to create slower, more inertial turns.
      angleVelocity += angleDelta * dt * 0.42;
      angleVelocity *= Math.exp(-0.85 * dt);
      angle += angleVelocity * dt;

      noiseValue += (noiseTarget - noiseValue) * Math.min(1, dt * 0.28);

      const elapsed = now - startAt;
      const phase = ((elapsed % cycleMs) / cycleMs) * Math.PI * 2;
      const breathing = 1 + 0.08 * Math.sin(phase * 2 + breathPhase);
      const radialWave =
        Math.sin(phase) +
        harmonic2 * Math.sin(2 * phase) +
        harmonic3 * Math.sin(3 * phase);
      const entropyAngle =
        angle +
        0.24 * Math.sin(phase * 1.41 + entropyPhaseA) +
        0.12 * Math.sin(phase * 2.23 + entropyPhaseB) +
        noiseValue * 0.14;
      const radius =
        baseAmplitude *
        launchFactor *
        radialWave *
        breathing *
        (1 + noiseValue * 0.2) *
        globalSpeedScale;

      const offsetX = Math.cos(entropyAngle) * radius;
      const offsetY = Math.sin(entropyAngle) * radius;

      layer.style.transform =
        "translate3d(" +
        offsetX.toFixed(2) +
        "px, " +
        offsetY.toFixed(2) +
        "px, 0)";
      requestAnimationFrame(tick);
    };

    window.addEventListener("resize", () => {
      updatePlaneBounds();
      recomputeAmplitude();
    });

    requestAnimationFrame(tick);
  }
}
