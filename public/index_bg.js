const layer = document.getElementById("mist-layer");

if (layer) {
  const BASE_RGB = [119, 221, 119]; // Base monochrome tint for all blobs.
  const BASE_TOTAL_COUNT = 6; // Baseline glow count before resolution adaptation.
  const BASE_CORNER_COUNT = 2; // Guaranteed blobs used for diagonal corner anchoring.
  const MIN_TOTAL_COUNT = 5; // Lower bound for total glow count on low-resolution screens.
  const MAX_TOTAL_COUNT = 8; // Upper bound for total glow count on high-resolution screens.
  const COUNT_RESOLUTION_WEIGHT = 0.9; // Weak resolution influence on total glow count.

  const BOUNDED_PLANE_SCALE = 1.5; // Plane side = longEdgePx * 1.5 => area = (longEdgePx * 1.5)^2.
  const CORNER_RADIUS_RATIO_MIN = 0.195; // Corner blob minimum radius / plane side.
  const CORNER_RADIUS_RATIO_MAX = 0.225; // Corner blob maximum radius / plane side.
  const RANDOM_RADIUS_RATIO_MIN = 0.265; // Distributed blob minimum radius / plane side.
  const RANDOM_RADIUS_RATIO_MAX = 0.32; // Distributed blob maximum radius / plane side.
  const RADIUS_RESOLUTION_EXPONENT = 0.18; // Moderate resolution influence on glow radius.
  const RADIUS_RESOLUTION_SCALE_MIN = 0.9; // Minimum radius scaling for low-resolution screens.
  const RADIUS_RESOLUTION_SCALE_MAX = 1.15; // Maximum radius scaling for high-resolution screens.
  const MIN_RADIUS_RATIO_CAP = 0.16; // Hard lower cap for all glow radius ratios.
  const MAX_RADIUS_RATIO_CAP = 0.38; // Hard upper cap for all glow radius ratios.

  // Lower bound of distribution uniformity. Larger value enforces more even spacing.
  const UNIFORMITY_FLOOR = 0.76; // Minimum spacing strictness for blob layout.
  const CANDIDATE_ATTEMPTS = 220; // Placement search budget per blob.
  const EDGE_TARGET_COUNT = 2; // Target number of blobs near edges.
  const EDGE_BAND_WIDTH = 10; // Edge attraction band width in field-space percent.
  const FIELD_MIN = 4; // Safe insets from normalized field border (percent).
  const FIELD_MAX = 96; // Safe insets from normalized field border (percent).
  const CORNER_OFFSET_MAX = 6.0; // Max inward jitter for guaranteed corner blobs (percent).
  const EXCLUDED_CORNER_RADIUS = 16; // Exclusion radius around the opposite diagonal corners (percent).

  const BLOB_ASPECT_RATIO_MIN = 0.96; // Minimum ellipse aspect ratio.
  const BLOB_ASPECT_RATIO_MAX = 1.12; // Maximum ellipse aspect ratio.
  const BLOB_BLUR_PX_MIN = 94; // Minimum glow blur radius (px).
  const BLOB_BLUR_PX_MAX = 110; // Maximum glow blur radius (px).

  const REFERENCE_SHORT_EDGE_PX = 1080; // Baseline short-edge used for resolution scaling.
  const GRAIN_RADIUS_HI_BASE_PX = 88; // High-frequency grain radius baseline (px).
  const GRAIN_RADIUS_LO_BASE_PX = 154; // Low-frequency grain radius baseline (px).

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
  const points = [];
  let planeSide = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let longEdgePx = 0;
  let shortEdgePx = 0;
  let recomputeAmplitude = () => {};
  let resizeFrame = 0;
  const styleCache = new Map();

  const randomInRange = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const setStyleVar = (name, value) => {
    if (styleCache.get(name) === value) {
      return;
    }
    styleCache.set(name, value);
    layer.style.setProperty(name, value);
  };

  const updatePlaneBounds = () => {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    longEdgePx = Math.max(viewportWidth, viewportHeight);
    shortEdgePx = Math.min(viewportWidth, viewportHeight);
    planeSide = longEdgePx * BOUNDED_PLANE_SCALE;

    layer.style.inset = "auto";
    layer.style.width = String(planeSide) + "px";
    layer.style.height = String(planeSide) + "px";
    layer.style.left = String((viewportWidth - planeSide) * 0.5) + "px";
    layer.style.top = String((viewportHeight - planeSide) * 0.5) + "px";
  };

  const applyDisplayTuning = () => {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const isMobileLike = isCoarsePointer || shortEdgePx < 860;
    const resolutionScale = clamp(
      shortEdgePx / REFERENCE_SHORT_EDGE_PX,
      0.7,
      1.9,
    );

    // Keep desktop baseline stable while lifting visibility on high-density displays.
    const visibilityBoost = clamp(
      (dpr - 1) * 0.2 + (isMobileLike ? 0.08 : 0),
      0,
      0.34,
    );

    // Requirement 1: shortEdgePx is positively correlated with grain radius.
    const grainRadiusHiPx = Math.round(
      GRAIN_RADIUS_HI_BASE_PX * resolutionScale * (1 + visibilityBoost * 0.35),
    );
    const grainRadiusLoPx = Math.round(
      GRAIN_RADIUS_LO_BASE_PX * resolutionScale * (1 + visibilityBoost * 0.25),
    );
    const grainOpacity = clamp(0.27 + visibilityBoost * 0.1, 0.27, 0.34); // Grain presence strength.
    const grainDriftDuration = clamp(16 - visibilityBoost * 2.0, 13.5, 16); // Grain drift speed.

    const veilOpacity = clamp(0.55 + visibilityBoost * 0.04, 0.55, 0.61); // Frost veil energy.
    const veilSaturate = Math.round(96 + visibilityBoost * 10); // Frost chroma lift.

    // Saturation compensation for dark valleys on high-density mobile displays.
    const glowSaturation = Math.round(106 + visibilityBoost * 8); // Blob saturation gain.
    const glowCoreAlpha = clamp(0.66 + visibilityBoost * 0.06, 0.66, 0.72); // Blob core density.
    const glowHaloAlpha = clamp(0.34 + visibilityBoost * 0.06, 0.34, 0.4); // Blob halo density.

    // CSS mask expects tile diameter, so we convert radius to diameter here.
    setStyleVar("--grain-size-hi", String(grainRadiusHiPx * 2) + "px");
    setStyleVar("--grain-size-lo", String(grainRadiusLoPx * 2) + "px");
    setStyleVar("--grain-opacity", String(grainOpacity));
    setStyleVar(
      "--grain-drift-duration",
      String(grainDriftDuration.toFixed(2)) + "s",
    );

    setStyleVar("--veil-opacity", String(veilOpacity));
    setStyleVar("--veil-saturate", String(veilSaturate) + "%");

    setStyleVar("--glow-sat", String(glowSaturation) + "%");
    setStyleVar("--glow-core-alpha", String(glowCoreAlpha));
    setStyleVar("--glow-halo-alpha", String(glowHaloAlpha));
  };

  const syncViewportState = () => {
    updatePlaneBounds();
    applyDisplayTuning();
    recomputeAmplitude();
  };

  const scheduleViewportChange = () => {
    if (resizeFrame !== 0) {
      return;
    }

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      syncViewportState();
    });
  };

  syncViewportState();
  window.addEventListener("resize", scheduleViewportChange, { passive: true });

  // Effective resolution uses short edge and DPR to reflect real visual density.
  const effectiveResolution = Math.max(
    (shortEdgePx * clamp(window.devicePixelRatio || 1, 1, 3)) /
      REFERENCE_SHORT_EDGE_PX,
    0.25,
  );
  const radiusScale = clamp(
    Math.pow(effectiveResolution, RADIUS_RESOLUTION_EXPONENT),
    RADIUS_RESOLUTION_SCALE_MIN,
    RADIUS_RESOLUTION_SCALE_MAX,
  );

  // Weak count adaptation: count changes slowly across resolution classes.
  const totalCount = Math.round(
    clamp(
      BASE_TOTAL_COUNT +
        COUNT_RESOLUTION_WEIGHT * Math.log2(effectiveResolution),
      MIN_TOTAL_COUNT,
      MAX_TOTAL_COUNT,
    ),
  );
  const cornerCount = Math.min(BASE_CORNER_COUNT, totalCount);
  const randomCount = Math.max(0, totalCount - cornerCount);

  const scaleRadiusRatio = (baseRatio) =>
    clamp(baseRatio * radiusScale, MIN_RADIUS_RATIO_CAP, MAX_RADIUS_RATIO_CAP);
  const cornerRadiusRatioMin = scaleRadiusRatio(CORNER_RADIUS_RATIO_MIN);
  const cornerRadiusRatioMax = scaleRadiusRatio(CORNER_RADIUS_RATIO_MAX);
  const randomRadiusRatioMin = scaleRadiusRatio(RANDOM_RADIUS_RATIO_MIN);
  const randomRadiusRatioMax = scaleRadiusRatio(RANDOM_RADIUS_RATIO_MAX);
  const randomRadiusSpan = Math.max(
    randomRadiusRatioMax - randomRadiusRatioMin,
    0.0001,
  );
  const cornerRadiusSpan = Math.max(
    cornerRadiusRatioMax - cornerRadiusRatioMin,
    0.0001,
  );

  const radiusRatioToDiameterPx = (radiusRatio) => planeSide * radiusRatio * 2;
  const sizeWeight = (radiusRatio) =>
    clamp((radiusRatio - randomRadiusRatioMin) / randomRadiusSpan, 0, 1);
  const cornerWeight = (radiusRatio) =>
    clamp((radiusRatio - cornerRadiusRatioMin) / cornerRadiusSpan, 0, 1);

  const targetSpacing =
    ((FIELD_MAX - FIELD_MIN) / Math.sqrt(Math.max(totalCount, 1))) * 0.95; // Baseline nearest-neighbor spacing in field-space.

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

  const pickDistributedPoint = (radiusRatio, preferEdge) => {
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

      const minDist = adaptiveMinDistance(radiusRatio, near.p1.size);
      const maxDist = adaptiveMaxDistance(radiusRatio, near.p1.size);
      if (near.d1 < minDist || near.d1 > maxDist) {
        continue;
      }

      const d2 = Number.isFinite(near.d2) ? near.d2 : targetSpacing;
      let score =
        Math.abs(near.d1 - targetSpacing) +
        0.65 * Math.abs(d2 - targetSpacing) + // 2nd-neighbor regularization weight.
        0.5 * Math.abs(d2 - near.d1); // Local spacing symmetry weight.

      if (preferEdge) {
        score += edgeDistance(candidate.x, candidate.y) * 0.12; // Edge proximity encouragement weight.
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
    glow.style.setProperty("--size", String(config.sizePx.toFixed(2)) + "px");
    glow.style.setProperty("--ratio", String(config.ratio));
    glow.style.setProperty("--blur", String(config.blur) + "px");
    glow.style.setProperty("--opacity", String(config.opacity));

    layer.appendChild(glow);
    points.push({ x: config.x, y: config.y, size: config.radiusRatio });
  };

  for (let i = 0; i < cornerCount; i += 1) {
    const corner = cornerPointFromEndpoint(guaranteedCorners[i]);
    const radiusRatio = randomInRange(
      cornerRadiusRatioMin,
      cornerRadiusRatioMax,
    );
    const sizeMix = cornerWeight(radiusRatio);

    addGlow({
      x: corner.x,
      y: corner.y,
      radiusRatio,
      sizePx: radiusRatioToDiameterPx(radiusRatio),
      ratio: randomInRange(BLOB_ASPECT_RATIO_MIN, BLOB_ASPECT_RATIO_MAX),
      blur: randomInRange(BLOB_BLUR_PX_MIN, BLOB_BLUR_PX_MAX),
      opacity: clamp(0.7 + sizeMix * 0.18, 0.68, 0.88),
    });
  }

  const edgeCount = Math.min(EDGE_TARGET_COUNT, randomCount);
  for (let i = 0; i < edgeCount; i += 1) {
    const radiusRatio = randomInRange(
      randomRadiusRatioMin,
      randomRadiusRatioMax,
    );
    const sizeMix = sizeWeight(radiusRatio);
    const candidate = pickDistributedPoint(radiusRatio, true);

    addGlow({
      x: candidate.x,
      y: candidate.y,
      radiusRatio,
      sizePx: radiusRatioToDiameterPx(radiusRatio),
      ratio: randomInRange(BLOB_ASPECT_RATIO_MIN, BLOB_ASPECT_RATIO_MAX),
      blur: randomInRange(BLOB_BLUR_PX_MIN, BLOB_BLUR_PX_MAX),
      opacity: clamp(0.55 + sizeMix * 0.2 + randomInRange(0, 0.04), 0.52, 0.82),
    });
  }

  for (let i = edgeCount; i < randomCount; i += 1) {
    const radiusRatio = randomInRange(
      randomRadiusRatioMin,
      randomRadiusRatioMax,
    );
    const sizeMix = sizeWeight(radiusRatio);
    const bestCandidate = pickDistributedPoint(radiusRatio, false);

    addGlow({
      x: bestCandidate.x,
      y: bestCandidate.y,
      radiusRatio,
      sizePx: radiusRatioToDiameterPx(radiusRatio),
      ratio: randomInRange(BLOB_ASPECT_RATIO_MIN, BLOB_ASPECT_RATIO_MAX),
      blur: randomInRange(BLOB_BLUR_PX_MIN, BLOB_BLUR_PX_MAX),
      opacity: clamp(0.55 + sizeMix * 0.2 + randomInRange(0, 0.04), 0.52, 0.82),
    });
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (!prefersReducedMotion) {
    // Regression period constants (safe to tune): larger values => slower return cycle.
    const REGRESSION_PERIOD_MIN_MS = 18000; // Minimum full return cycle duration.
    const REGRESSION_PERIOD_MAX_MS = 26000; // Maximum full return cycle duration.

    const startAngle = randomInRange(0, Math.PI * 2); // Initial drift angle.
    const cycleMs = randomInRange(
      REGRESSION_PERIOD_MIN_MS,
      REGRESSION_PERIOD_MAX_MS,
    );
    const accelMs = 5200; // Launch easing duration.
    const directionShiftMinMs = 5200; // Minimum turn interval.
    const directionShiftMaxMs = 8200; // Maximum turn interval.
    const directionJitterRad = 0.055; // Maximum directional jitter per turn.
    const noiseShiftMinMs = 2600; // Minimum entropy update interval.
    const noiseShiftMaxMs = 4600; // Maximum entropy update interval.
    const harmonic2 = randomInRange(0.16, 0.24); // Second harmonic influence.
    const harmonic3 = randomInRange(0.06, 0.12); // Third harmonic influence.
    const entropyPhaseA = randomInRange(0, Math.PI * 2); // Entropy phase A.
    const entropyPhaseB = randomInRange(0, Math.PI * 2); // Entropy phase B.
    const globalSpeedScale = 0.52; // Global movement amplitude multiplier.

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
    const breathPhase = randomInRange(0, Math.PI * 2); // Independent breathing phase.
    const amplitudeFactor = randomInRange(0.72, 0.86); // Stable amplitude seed across resizes.

    let baseAmplitude = 0;

    recomputeAmplitude = () => {
      const margin = Math.max(24, (planeSide - longEdgePx) * 0.5);
      baseAmplitude = margin * amplitudeFactor;
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

    requestAnimationFrame(tick);
  }
}
