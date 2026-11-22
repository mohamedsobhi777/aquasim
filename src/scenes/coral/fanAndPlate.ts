import * as THREE from 'three';
import { createRng, hashString } from '../../core/rng';
import FastNoiseLite from '../../vendor/fastnoise-lite';
import { TAU, UP_DIR, DEG2RAD, ZERO_VEC, PI } from './const';
import type { RandomFunc } from './types';
import { randRange } from './lib/math';

function coralBaseRock_generate(seedHash: string) {
  const baseRock_minHeight = 0.05;
  const baseRock_maxHeight = 0.08;
  const baseRock_minRadius = 0.12;
  const baseRock_maxRadius = 0.17;
  const baseRock_widthSegments = 32;
  const baseRock_heightSegments = 16;
  const baseRock_deformation = 0.22;
  const rockRandFn = createRng(hashString(`${seedHash}/baseRock`)).next;
  const rockHeight = randRange({
    a: baseRock_minHeight,
    b: baseRock_maxHeight,
    randFn: rockRandFn,
  });
  const rockRadius = randRange({
    a: baseRock_minRadius,
    b: baseRock_maxRadius,
    randFn: rockRandFn,
  });
  const rockNoise = new FastNoiseLite(Math.floor(rockRandFn() * 2147483647));
  rockNoise.SetFrequency(1.5);
  const rockGeometry = new THREE.SphereGeometry(1, baseRock_widthSegments, baseRock_heightSegments, 0, TAU, 0, PI / 2);
  const rockPosition = rockGeometry.getAttribute('position');

  let maxRockHeight = 0;
  let maxRockRadius = 0;
  for (let i = 0; i < rockPosition.count; i++) {
    const x = rockPosition.getX(i);
    const y = rockPosition.getY(i);
    const z = rockPosition.getZ(i);
    const deformation = 1 + baseRock_deformation * rockNoise.GetNoise(x, y, z);
    const deformedX = x * deformation;
    const deformedY = y * deformation;
    const deformedZ = z * deformation;
    rockPosition.setXYZ(i, deformedX, deformedY, deformedZ);
    maxRockHeight = Math.max(maxRockHeight, deformedY);
    maxRockRadius = Math.max(maxRockRadius, Math.hypot(deformedX, deformedZ));
  }
  rockGeometry.scale(rockRadius / maxRockRadius, rockHeight / maxRockHeight, rockRadius / maxRockRadius);
  const rockRimStart = rockPosition.count - baseRock_widthSegments - 1;
  for (let i = rockRimStart; i < rockPosition.count; i++) {
    rockPosition.setY(i, 0);
  }
  rockGeometry.computeVertexNormals();

  const positions = Array.from(rockPosition.array);
  const normals = Array.from(rockGeometry.getAttribute('normal').array);
  const indices = Array.from(rockGeometry.getIndex()!.array);
  const bottomCenter = rockPosition.count;
  positions.push(0, 0, 0);
  normals.push(0, -1, 0);
  for (let i = 0; i <= baseRock_widthSegments; i++) {
    positions.push(rockPosition.getX(rockRimStart + i), 0, rockPosition.getZ(rockRimStart + i));
    normals.push(0, -1, 0);
    if (i > 0) {
      indices.push(bottomCenter, bottomCenter + i + 1, bottomCenter + i);
    }
  }
  rockGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  rockGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  rockGeometry.setIndex(indices);
  return { geometry: rockGeometry, height: rockHeight };
}

export function fanCoral_generate(params: {
  root_pt: THREE.Vector3;
  root_normalVec: THREE.Vector3;
  height: number;
  material: THREE.MeshStandardMaterial;
  seedHash: string;
  reefDetail?: boolean;
}) {
  type Branch = {
    start: THREE.Vector2;
    end: THREE.Vector2;
    startRadius: number;
    endRadius: number;
    angle: number;
    parent?: Branch;
  };
  type MainBranch = { segments: Branch[] };
  type BranchIndex = Map<string, Branch[]>;
  type AngleRange = { min: number; max: number };
  type TinyGrowth = {
    start: THREE.Vector2;
    angle: number;
    parent: Branch;
    distance: number;
  };
  type GeometryData = {
    positions: number[];
    normals: number[];
    indices: number[];
  };

  const mainBranch_maxLevel = 3;
  const mainBranch_segmentCnt = 3;
  const mainBranch_minHeightRatio = 0.9;
  const mainBranch_targetHeight = mainBranch_minHeightRatio + (1 - mainBranch_minHeightRatio) * 0.3;
  const mainBranch_min = 0.025;
  const mainBranch_max = 0.032;
  const tinyBranch_min = 0.001;
  const tinyBranch_max = 0.0016;
  const tinyBranch_maxDeviation_deg = 120;

  // Distances are relative to the requested height.
  const tinyBranch_gapOnMain = params.reefDetail ? 0.012 : 0.0025;
  const tinyBranch_segmentLenStep = params.reefDetail ? 0.025 : 0.01;
  const tinyBranch_maxGrowthDistance = 0.21;
  const mainCoral_topDelta = 0.015;
  const collisionCellSize = 0.1;
  const radialSegments = 6;
  const { root_pt, root_normalVec, height, material, seedHash } = params;

  // #region [sub]
  const branchCells = (branch: Branch) => {
    const radius = Math.max(branch.startRadius, branch.endRadius) * 1.05;
    const min = branch.start.clone().min(branch.end).addScalar(-radius);
    const max = branch.start.clone().max(branch.end).addScalar(radius);
    min.divideScalar(collisionCellSize).floor();
    max.divideScalar(collisionCellSize).floor();
    const cells: string[] = [];

    for (let x = min.x; x <= max.x; x++) {
      for (let y = min.y; y <= max.y; y++) {
        cells.push(`${x},${y}`);
      }
    }
    return cells;
  };

  const closestBranchPoints = (
    firstStart: THREE.Vector2,
    firstEnd: THREE.Vector2,
    secondStart: THREE.Vector2,
    secondEnd: THREE.Vector2,
  ) => {
    const u = firstEnd.clone().sub(firstStart);
    const v = secondEnd.clone().sub(secondStart);
    const w = firstStart.clone().sub(secondStart);
    const a = u.dot(u);
    const b = u.dot(v);
    const c = u.dot(w);
    const e = v.dot(v);
    const f = v.dot(w);
    const denominator = a * e - b * b;
    let s = denominator > 1e-12 * a * e ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1) : 0;
    let t = (b * s + f) / e;

    if (t < 0) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else if (t > 1) {
      t = 1;
      s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
    }
    return firstStart.clone().addScaledVector(u, s).distanceTo(secondStart.clone().addScaledVector(v, t));
  };

  const branchCanGrow = (branch: Branch, parent: Branch | undefined, index: BranchIndex) => {
    const nearby = new Set<Branch>();
    for (const cell of branchCells(branch)) {
      for (const existing of index.get(cell) ?? []) {
        nearby.add(existing);
      }
    }

    for (const existing of nearby) {
      let ancestor = parent;
      while (ancestor && ancestor !== existing) {
        ancestor = ancestor.parent;
      }
      const existingDirection = existing.end.clone().sub(existing.start);
      const startProjection = THREE.MathUtils.clamp(
        branch.start.clone().sub(existing.start).dot(existingDirection) / existingDirection.lengthSq(),
        0,
        1,
      );
      const startDistance = branch.start.distanceTo(
        existing.start.clone().addScaledVector(existingDirection, startProjection),
      );
      const startRadius = THREE.MathUtils.lerp(existing.startRadius, existing.endRadius, startProjection);
      const connected =
        (ancestor === existing ||
          existing.start.distanceToSquared(branch.start) < 1e-12 ||
          existing.end.distanceToSquared(branch.start) < 1e-12) &&
        startDistance < (branch.startRadius + startRadius) * 1.05;
      if (connected) {
        // A connected branch may overlap at its base, but must emerge from it.
        const endProjection = THREE.MathUtils.clamp(
          branch.end.clone().sub(existing.start).dot(existingDirection) / existingDirection.lengthSq(),
          0,
          1,
        );
        const endDistance = branch.end.distanceTo(
          existing.start.clone().addScaledVector(existingDirection, endProjection),
        );
        const endRadius = THREE.MathUtils.lerp(existing.startRadius, existing.endRadius, endProjection);
        if (endDistance < (branch.endRadius + endRadius) * 1.05) {
          return false;
        }
        continue;
      }

      const firstParts = branch.startRadius === branch.endRadius ? 1 : 2;
      const secondParts = existing.startRadius === existing.endRadius ? 1 : 2;
      for (let i = 0; i < firstParts; i++) {
        const firstA = i / firstParts;
        const firstB = (i + 1) / firstParts;
        const firstRadius = Math.max(
          THREE.MathUtils.lerp(branch.startRadius, branch.endRadius, firstA),
          THREE.MathUtils.lerp(branch.startRadius, branch.endRadius, firstB),
        );
        for (let j = 0; j < secondParts; j++) {
          const secondA = j / secondParts;
          const secondB = (j + 1) / secondParts;
          const secondRadius = Math.max(
            THREE.MathUtils.lerp(existing.startRadius, existing.endRadius, secondA),
            THREE.MathUtils.lerp(existing.startRadius, existing.endRadius, secondB),
          );
          const closest = closestBranchPoints(
            branch.start.clone().lerp(branch.end, firstA),
            branch.start.clone().lerp(branch.end, firstB),
            existing.start.clone().lerp(existing.end, secondA),
            existing.start.clone().lerp(existing.end, secondB),
          );
          if (closest < (firstRadius + secondRadius) * 1.05) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const indexBranch = (branch: Branch, index: BranchIndex) => {
    for (const cell of branchCells(branch)) {
      const list = index.get(cell);
      if (list) {
        list.push(branch);
      } else {
        index.set(cell, [branch]);
      }
    }
  };

  const removeBranch = (branch: Branch, index: BranchIndex) => {
    for (const cell of branchCells(branch)) {
      const list = index.get(cell);
      if (list) {
        const position = list.indexOf(branch);
        if (position !== -1) {
          list.splice(position, 1);
        }
        if (list.length === 0) {
          index.delete(cell);
        }
      }
    }
  };

  const tinyBranch_boundAngle = (angle: number, ranges: AngleRange[]) => {
    let range = ranges[0];
    let distance = Math.max(range.min - angle, 0, angle - range.max);
    for (let i = 1; i < ranges.length; i++) {
      const candidate = ranges[i];
      const candidateDistance = Math.max(candidate.min - angle, 0, angle - candidate.max);
      if (candidateDistance < distance) {
        range = candidate;
        distance = candidateDistance;
      }
    }

    const width = range.max - range.min;
    if (width < 1e-12) {
      return range.min;
    }
    const period = 2 * width;
    const offset = (((angle - range.min) % period) + period) % period;
    return range.min + (offset <= width ? offset : period - offset);
  };

  const addBranch = (branch: Branch, geometryData: GeometryData) => {
    const { start, end, startRadius, endRadius } = branch;
    const { positions, normals, indices } = geometryData;
    const direction = end.clone().sub(start).normalize();
    const side = new THREE.Vector3(direction.y, -direction.x, 0);
    const depth = new THREE.Vector3(0, 0, 1);
    const firstVertex = positions.length / 3;

    for (let ring = 0; ring < 2; ring++) {
      const center = ring === 0 ? start : end;
      const radius = ring === 0 ? startRadius : endRadius;

      for (let i = 0; i < radialSegments; i++) {
        const angle = (i / radialSegments) * TAU;
        const normal = side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(depth, Math.sin(angle));
        const point = new THREE.Vector3(center.x, center.y, 0).addScaledVector(normal, radius);
        point.y = Math.max(0, point.y);
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
      }
    }

    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      const a = firstVertex + i;
      const b = firstVertex + next;
      const c = firstVertex + radialSegments + i;
      const d = firstVertex + radialSegments + next;
      indices.push(a, c, b, b, c, d);
    }
  };

  const addMainJoint = (
    center: THREE.Vector2,
    radius: number,
    jointGeometry: THREE.SphereGeometry,
    geometryData: GeometryData,
  ) => {
    const firstVertex = geometryData.positions.length / 3;
    const position = jointGeometry.getAttribute('position');
    const normal = jointGeometry.getAttribute('normal');
    const jointIndex = jointGeometry.getIndex()!;
    for (let i = 0; i < position.count; i++) {
      geometryData.positions.push(
        center.x + position.getX(i) * radius * 1.05,
        Math.max(0, center.y + position.getY(i) * radius * 1.05),
        position.getZ(i) * radius * 1.05,
      );
      geometryData.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    for (let i = 0; i < jointIndex.count; i++) {
      geometryData.indices.push(firstVertex + jointIndex.getX(i));
    }
  };

  const growMainBranch = (
    start: THREE.Vector2,
    angle: number,
    radius: number,
    level: number,
    branches: MainBranch[],
    parent: Branch | undefined,
    index: BranchIndex,
    randFn: RandomFunc,
  ): boolean => {
    const isTerminal = level === mainBranch_maxLevel;
    const endRadius = radius * (isTerminal ? 0.14 + randFn() * 0.12 : 0.65 + randFn() * 0.2);
    const targetHeight = (mainBranch_targetHeight * level) / mainBranch_maxLevel;
    const heightStep = (targetHeight - start.y) / mainBranch_segmentCnt;
    let segmentStart = start;
    let segmentAngle = angle;
    let previous = parent;
    const segments: Branch[] = [];

    for (let i = 0; i < mainBranch_segmentCnt; i++) {
      segmentAngle = THREE.MathUtils.clamp(segmentAngle + (randFn() - 0.5) * 0.28, -1.15, 1.15);
      const segmentLength = heightStep / Math.cos(segmentAngle);
      const segmentEnd = segmentStart
        .clone()
        .add(new THREE.Vector2(Math.sin(segmentAngle) * segmentLength, Math.cos(segmentAngle) * segmentLength));
      const segment: Branch = {
        start: segmentStart,
        end: segmentEnd,
        startRadius: THREE.MathUtils.lerp(radius, endRadius, i / mainBranch_segmentCnt),
        endRadius: THREE.MathUtils.lerp(radius, endRadius, (i + 1) / mainBranch_segmentCnt),
        angle: segmentAngle,
        parent: previous,
      };
      if (!branchCanGrow(segment, previous, index)) {
        for (const added of segments) {
          removeBranch(added, index);
        }
        return false;
      }
      indexBranch(segment, index);
      segments.push(segment);
      previous = segment;
      segmentStart = segmentEnd;
    }

    // Discard incomplete paths so every surviving main tip reaches the target.
    if (!isTerminal) {
      let hasChild = false;
      for (const sign of [-1, 1]) {
        const childAngle = THREE.MathUtils.clamp(
          segmentAngle * (0.65 + randFn() * 0.25) + sign * (0.18 + randFn() * 0.5),
          -1.15,
          1.15,
        );
        if (growMainBranch(segmentStart, childAngle, endRadius, level + 1, branches, previous, index, randFn)) {
          hasChild = true;
        }
      }
      if (!hasChild) {
        for (const added of segments) {
          removeBranch(added, index);
        }
        return false;
      }
    }
    branches.push({ segments });
    return true;
  };

  const growTinyBranch = (
    growth: TinyGrowth,
    radius: number,
    angleRanges: AngleRange[],
    index: BranchIndex,
    branches: Branch[],
    pending: TinyGrowth[],
    randFn: RandomFunc,
  ) => {
    const { start, angle, parent, distance } = growth;
    if (start.y < radius || distance >= tinyBranch_maxGrowthDistance) {
      return;
    }

    const segmentLength = Math.min(tinyBranch_segmentLenStep, tinyBranch_maxGrowthDistance - distance);
    if (segmentLength <= 1e-9) {
      return;
    }
    const vertical = Math.cos(angle);
    const end = start
      .clone()
      .add(
        new THREE.Vector2(Math.sin(angle) * segmentLength, Math.abs(vertical) < 1e-12 ? 0 : vertical * segmentLength),
      );
    if (end.y < radius) {
      return;
    }
    const branch = {
      start,
      end,
      startRadius: radius,
      endRadius: radius,
      angle,
      parent,
    };
    if (!branchCanGrow(branch, parent, index)) {
      return;
    }
    indexBranch(branch, index);
    branches.push(branch);

    const nextDistance = distance + segmentLength;
    if (nextDistance >= tinyBranch_maxGrowthDistance - 1e-9) {
      return;
    }

    for (const sign of [-1, 1]) {
      pending.push({
        start: end,
        angle: tinyBranch_boundAngle(angle + sign * (0.18 + randFn() * 0.3), angleRanges),
        parent: branch,
        distance: nextDistance,
      });
    }
  };
  // #endregion [sub]

  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError('Fan coral height must be a positive finite number');
  }
  if (
    !Number.isFinite(root_normalVec.x) ||
    !Number.isFinite(root_normalVec.y) ||
    !Number.isFinite(root_normalVec.z) ||
    (root_normalVec.x === 0 && root_normalVec.y === 0 && root_normalVec.z === 0)
  ) {
    throw new RangeError('Fan coral root normal must be a finite nonzero vector');
  }
  if (![root_pt.x, root_pt.y, root_pt.z].every(Number.isFinite)) {
    throw new RangeError('Fan coral root point must be finite');
  }
  if (
    !Number.isFinite(tinyBranch_maxDeviation_deg) ||
    tinyBranch_maxDeviation_deg < 0 ||
    tinyBranch_maxDeviation_deg > 180
  ) {
    throw new RangeError('Tiny branch maximum deviation must be between 0 and 180 degrees');
  }

  const normalScale = Math.max(Math.abs(root_normalVec.x), Math.abs(root_normalVec.y), Math.abs(root_normalVec.z));
  const normal = new THREE.Vector3(
    root_normalVec.x / normalScale,
    root_normalVec.y / normalScale,
    root_normalVec.z / normalScale,
  ).normalize();
  const planeNormal = new THREE.Vector3().crossVectors(normal, UP_DIR);
  const planeScale = Math.max(Math.abs(planeNormal.x), Math.abs(planeNormal.z));
  const horizontal = new THREE.Vector3();
  if (planeScale === 0) {
    horizontal.set(1, 0, 0);
  } else {
    planeNormal.set(planeNormal.x / planeScale, 0, planeNormal.z / planeScale);
    horizontal.crossVectors(planeNormal, normal).normalize();
  }
  const depth = new THREE.Vector3().crossVectors(horizontal, normal).normalize();
  const maxDeviation = tinyBranch_maxDeviation_deg * DEG2RAD;
  const upAngle = Math.atan2(horizontal.y, normal.y);
  const localAngleLimit = PI;
  const angleRanges: AngleRange[] = [];
  const minAngle = Math.max(-localAngleLimit, Math.atan2(-normal.y, horizontal.y) + (PI / 2 - maxDeviation));
  const maxAngle = Math.min(localAngleLimit, upAngle + maxDeviation);
  if (minAngle <= maxAngle) {
    angleRanges.push({ min: minAngle, max: maxAngle });
  }

  // The allowed world-up sector can wrap across the local angle boundary.
  const wrappedMin = Math.max(-localAngleLimit, upAngle - maxDeviation - TAU);
  const wrappedMax = Math.min(localAngleLimit, upAngle + maxDeviation - TAU);
  if (wrappedMin <= wrappedMax && (angleRanges.length === 0 || wrappedMax > wrappedMin)) {
    const first = angleRanges[0];
    if (first && wrappedMax >= first.min) {
      first.min = wrappedMin;
    } else {
      angleRanges.push({ min: wrappedMin, max: wrappedMax });
    }
  }
  if (angleRanges.length === 0) {
    throw new RangeError('Tiny branch deviation allows no growth above the root surface');
  }

  const randFn = createRng(hashString(seedHash)).next;
  const mainBranch_initialRadius = randRange({
    a: mainBranch_min,
    b: mainBranch_max,
    randFn,
  });
  const tinyBranch_radius = THREE.MathUtils.clamp(mainBranch_initialRadius * 0.2, tinyBranch_min, tinyBranch_max);
  const mainBranches: MainBranch[] = [];
  const tinyBranches: Branch[] = [];
  const branchIndex: BranchIndex = new Map();
  const pendingTiny: TinyGrowth[] = [];
  const geometryData: GeometryData = { positions: [], normals: [], indices: [] };

  const spineAngle = (randFn() - 0.5) * 0.3;
  const spinePhase = randFn() * TAU;
  let spinePoint = new THREE.Vector2();
  let spineRadius = mainBranch_initialRadius;
  let spineParent: Branch | undefined;
  const spineBranches: MainBranch[] = [];
  for (let level = 1; level <= mainBranch_maxLevel; level++) {
    const endRadius = spineRadius * (level === mainBranch_maxLevel ? 0.2 : 0.75);
    const segments: Branch[] = [];
    for (let i = 0; i < mainBranch_segmentCnt; i++) {
      const step = (level - 1) * mainBranch_segmentCnt + i;
      const angle = spineAngle + 0.08 * Math.sin(spinePhase + step * 0.6);
      const nextHeight = (mainBranch_targetHeight * (step + 1)) / (mainBranch_maxLevel * mainBranch_segmentCnt);
      const length = (nextHeight - spinePoint.y) / Math.cos(angle);
      const end = spinePoint.clone().add(new THREE.Vector2(Math.sin(angle) * length, Math.cos(angle) * length));
      const segment: Branch = {
        start: spinePoint,
        end,
        startRadius: THREE.MathUtils.lerp(spineRadius, endRadius, i / mainBranch_segmentCnt),
        endRadius: THREE.MathUtils.lerp(spineRadius, endRadius, (i + 1) / mainBranch_segmentCnt),
        angle,
        parent: spineParent,
      };
      if (!branchCanGrow(segment, spineParent, branchIndex)) {
        throw new Error("Unable to grow the fan coral's main spine");
      }
      indexBranch(segment, branchIndex);
      segments.push(segment);
      spinePoint = end;
      spineParent = segment;
    }
    const mainBranch = { segments };
    mainBranches.push(mainBranch);
    spineBranches.push(mainBranch);
    spineRadius = endRadius;
  }

  const oppositeSide = spineAngle < 0 ? 1 : -1;
  growMainBranch(
    new THREE.Vector2(),
    oppositeSide * (0.55 + randFn() * 0.2),
    mainBranch_initialRadius,
    1,
    mainBranches,
    undefined,
    branchIndex,
    randFn,
  );
  for (let level = 1; level < mainBranch_maxLevel; level++) {
    const parent = spineBranches[level - 1].segments[mainBranch_segmentCnt - 1];
    const sign = level === 1 ? -oppositeSide : oppositeSide;
    growMainBranch(
      parent.end,
      sign * (0.4 + randFn() * 0.35),
      parent.endRadius,
      level + 1,
      mainBranches,
      parent,
      branchIndex,
      randFn,
    );
  }

  for (const mainBranch of mainBranches) {
    let distanceAlongBranch = 0;
    let nextStartDistance = tinyBranch_gapOnMain / 2;
    for (const branch of mainBranch.segments) {
      const length = branch.start.distanceTo(branch.end);
      const side = new THREE.Vector2(Math.cos(branch.angle), -Math.sin(branch.angle));
      while (nextStartDistance < distanceAlongBranch + length) {
        const fraction = (nextStartDistance - distanceAlongBranch) / length;
        const radius = THREE.MathUtils.lerp(branch.startRadius, branch.endRadius, fraction);
        for (const sign of [-1, 1]) {
          pendingTiny.push({
            start: branch.start
              .clone()
              .lerp(branch.end, fraction)
              .addScaledVector(side, sign * Math.max(0, radius - tinyBranch_radius * 2)),
            angle: tinyBranch_boundAngle(branch.angle + sign * (0.65 + randFn() * 0.35), angleRanges),
            parent: branch,
            distance: 0,
          });
        }
        nextStartDistance += tinyBranch_gapOnMain;
      }
      distanceAlongBranch += length;
    }
  }

  const mainParents = new Set<Branch>();
  for (const mainBranch of mainBranches) {
    for (const segment of mainBranch.segments) {
      if (segment.parent) {
        mainParents.add(segment.parent);
      }
    }
  }
  const tipStarts: TinyGrowth[] = [];
  for (const mainBranch of mainBranches) {
    const tip = mainBranch.segments[mainBranch.segments.length - 1];
    if (!mainParents.has(tip)) {
      tipStarts.push({
        start: tip.end.clone(),
        angle: tinyBranch_boundAngle(tip.angle, angleRanges),
        parent: tip,
        distance: 0,
      });
    }
  }

  let frontier = [...tipStarts, ...pendingTiny];
  while (frontier.length > 0) {
    const next: TinyGrowth[] = [];
    for (const growth of frontier) {
      growTinyBranch(growth, tinyBranch_radius, angleRanges, branchIndex, tinyBranches, next, randFn);
    }
    frontier = next;
  }

  for (const mainBranch of mainBranches) {
    for (const segment of mainBranch.segments) {
      addBranch(segment, geometryData);
    }
  }
  for (const branch of tinyBranches) {
    addBranch(branch, geometryData);
  }

  const jointGeometry = new THREE.SphereGeometry(1, 16, 12);
  for (const mainBranch of mainBranches) {
    for (const branch of mainBranch.segments) {
      addMainJoint(branch.end, branch.endRadius, jointGeometry, geometryData);
    }
  }
  jointGeometry.dispose();

  const { geometry: rockGeometry, height: rockHeight } = coralBaseRock_generate(seedHash);
  const rockPosition = rockGeometry.getAttribute('position');

  const mainCoral_baseHeight = rockHeight - mainCoral_topDelta;
  for (let i = 1; i < geometryData.positions.length; i += 3) {
    geometryData.positions[i] += mainCoral_baseHeight;
  }

  const rockFirstVertex = geometryData.positions.length / 3;
  const rockNormal = rockGeometry.getAttribute('normal');
  const rockIndex = rockGeometry.getIndex()!;
  for (let i = 0; i < rockPosition.count; i++) {
    geometryData.positions.push(rockPosition.getX(i), rockPosition.getY(i), rockPosition.getZ(i));
    geometryData.normals.push(rockNormal.getX(i), rockNormal.getY(i), rockNormal.getZ(i));
  }
  for (let i = 0; i < rockIndex.count; i++) {
    geometryData.indices.push(rockFirstVertex + rockIndex.getX(i));
  }

  rockGeometry.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometryData.normals, 3));
  geometry.setIndex(geometryData.indices);
  geometry.scale(height, height, height);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(root_pt);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(horizontal, normal, depth));
  return mesh;
}

export function plateCoral_generate(params: {
  root_pt: THREE.Vector3;
  root_normalVec: THREE.Vector3;
  height: number;
  material: THREE.MeshStandardMaterial;
  seedHash: string;
  reefDetail?: boolean;
}) {
  // Distances are relative to the coral's height before final normalization.
  const bottomPlate_minRadius = 0.75;
  const bottomPlate_maxRadius = 0.95;
  const plateRadius_minReductionRate = 0.65;
  const plateRadius_maxReductionRate = 0.8;
  const plateBump_spacingDist = params.reefDetail ? 0.07 : 0.02;
  const plateBump_radius = 0.009;
  const plate_thickness = 0.025;
  const plate_levelSpacing = 0.1;
  const plate_rimHeight = 0.3;
  const stalk_radius = 0.035;
  const plate_radialSegments = 96;
  const plate_ringCnt = 16;
  const { root_pt, root_normalVec, height, material, seedHash } = params;

  // #region [sub]
  const appendGeometry = (
    geometry: THREE.BufferGeometry,
    positions: number[],
    normals: number[],
    indices: number[],
    offset: THREE.Vector3,
    scale = new THREE.Vector3(1, 1, 1),
  ) => {
    const firstVertex = positions.length / 3;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex()!;
    const transformedNormal = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      positions.push(
        position.getX(i) * scale.x + offset.x,
        position.getY(i) * scale.y + offset.y,
        position.getZ(i) * scale.z + offset.z,
      );
      transformedNormal.set(normal.getX(i) / scale.x, normal.getY(i) / scale.y, normal.getZ(i) / scale.z).normalize();
      normals.push(transformedNormal.x, transformedNormal.y, transformedNormal.z);
    }
    for (let i = 0; i < index.count; i++) {
      indices.push(firstVertex + index.getX(i));
    }
  };

  const addPlate = (
    radius: number,
    elevation: number,
    rimHeight: number,
    randFn: RandomFunc,
    bumpGeometry: THREE.SphereGeometry,
    positions: number[],
    normals: number[],
    indices: number[],
  ) => {
    const edgePhase = randFn() * TAU;
    const ripplePhase = randFn() * TAU;
    const gridAngle = randFn() * TAU;
    const noise = new FastNoiseLite(Math.floor(randFn() * 2147483647));
    noise.SetFrequency(3);
    const platePositions: number[] = [];
    const plateIndices: number[] = [];
    const ringSize = plate_radialSegments + 1;
    const surfaceVertexCnt = 1 + plate_ringCnt * ringSize;

    const edgeRadius = (angle: number) => {
      return radius * (1 + 0.045 * Math.sin(5 * angle + edgePhase) + 0.025 * Math.sin(9 * angle + ripplePhase));
    };
    const surfaceHeight = (x: number, z: number) => {
      const fraction = Math.hypot(x, z) / radius;
      return elevation + rimHeight * fraction * fraction + 0.012 * fraction * noise.GetNoise(x, z);
    };
    const triangulatedSurfaceHeight = (x: number, z: number) => {
      const angle = (Math.atan2(z, x) + TAU) % TAU;
      const segment = Math.floor((angle / TAU) * plate_radialSegments);
      for (let ring = 1; ring <= plate_ringCnt; ring++) {
        const triangleCnt = ring === 1 ? 1 : 2;
        const firstTriangle =
          ring === 1 ? segment : plate_radialSegments + (ring - 2) * plate_radialSegments * 2 + segment * 2;
        for (let i = 0; i < triangleCnt; i++) {
          const index = (firstTriangle + i) * 3;
          const a = plateIndices[index] * 3;
          const b = plateIndices[index + 1] * 3;
          const c = plateIndices[index + 2] * 3;
          const ax = platePositions[a];
          const az = platePositions[a + 2];
          const bx = platePositions[b] - ax;
          const bz = platePositions[b + 2] - az;
          const cx = platePositions[c] - ax;
          const cz = platePositions[c + 2] - az;
          const determinant = bx * cz - bz * cx;
          const weightB = ((x - ax) * cz - (z - az) * cx) / determinant;
          const weightC = (bx * (z - az) - bz * (x - ax)) / determinant;
          const weightA = 1 - weightB - weightC;
          if (weightA >= -1e-9 && weightB >= -1e-9 && weightC >= -1e-9) {
            return weightA * platePositions[a + 1] + weightB * platePositions[b + 1] + weightC * platePositions[c + 1];
          }
        }
      }
      throw new Error('Unable to locate the plate surface beneath a bump');
    };

    for (let side = 0; side < 2; side++) {
      const firstVertex = side * surfaceVertexCnt;
      const thickness = side === 0 ? 0 : plate_thickness;
      platePositions.push(0, elevation - thickness, 0);
      for (let ring = 1; ring <= plate_ringCnt; ring++) {
        for (let segment = 0; segment <= plate_radialSegments; segment++) {
          const angle = segment === plate_radialSegments ? 0 : (TAU * segment) / plate_radialSegments;
          const distance = (edgeRadius(angle) * ring) / plate_ringCnt;
          const x = Math.cos(angle) * distance;
          const z = Math.sin(angle) * distance;
          platePositions.push(x, surfaceHeight(x, z) - thickness, z);
          if (segment < plate_radialSegments) {
            const outer = firstVertex + 1 + (ring - 1) * ringSize + segment;
            const triangles =
              ring === 1
                ? [firstVertex, outer + 1, outer]
                : [outer - ringSize, outer + 1, outer, outer - ringSize, outer - ringSize + 1, outer + 1];
            for (let i = 0; i < triangles.length; i += 3) {
              if (side === 0) {
                plateIndices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
              } else {
                plateIndices.push(triangles[i], triangles[i + 2], triangles[i + 1]);
              }
            }
          }
        }
      }
    }
    const rimStart = 1 + (plate_ringCnt - 1) * ringSize;
    for (let i = 0; i < plate_radialSegments; i++) {
      const top = rimStart + i;
      const bottom = top + surfaceVertexCnt;
      plateIndices.push(top, top + 1, bottom, top + 1, bottom + 1, bottom);
    }
    const plateGeometry = new THREE.BufferGeometry();
    plateGeometry.setAttribute('position', new THREE.Float32BufferAttribute(platePositions, 3));
    plateGeometry.setIndex(plateIndices);
    plateGeometry.computeVertexNormals();
    appendGeometry(plateGeometry, positions, normals, indices, ZERO_VEC);
    plateGeometry.dispose();

    const rowSpacing = (plateBump_spacingDist * Math.sqrt(3)) / 2;
    const rowCnt = Math.ceil((radius * 1.07) / rowSpacing);
    const columnCnt = Math.ceil((radius * 1.07) / plateBump_spacingDist);
    const bumpScale = new THREE.Vector3(plateBump_radius, plateBump_radius * 0.75, plateBump_radius);
    const bumpCenter = new THREE.Vector3();
    for (let row = -rowCnt; row <= rowCnt; row++) {
      for (let column = -columnCnt; column <= columnCnt; column++) {
        const gridX = (column + (Math.abs(row) % 2) * 0.5) * plateBump_spacingDist;
        const gridZ = row * rowSpacing;
        const x = gridX * Math.cos(gridAngle) - gridZ * Math.sin(gridAngle);
        const z = gridX * Math.sin(gridAngle) + gridZ * Math.cos(gridAngle);
        if (Math.hypot(x, z) + plateBump_radius * 2 > edgeRadius(Math.atan2(z, x))) {
          continue;
        }
        const displacementNoise = THREE.MathUtils.clamp(noise.GetNoise(x * 12, z * 12, 23), -1, 1);
        // Even maximum displacement leaves the sphere crossing the surface.
        const displacement = bumpScale.y * 0.65 * displacementNoise;
        bumpCenter.set(x, triangulatedSurfaceHeight(x, z) + displacement, z);
        appendGeometry(bumpGeometry, positions, normals, indices, bumpCenter, bumpScale);
      }
    }
  };
  // #endregion [sub]

  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError('Plate coral height must be a positive finite number');
  }
  if (![root_pt.x, root_pt.y, root_pt.z].every(Number.isFinite)) {
    throw new RangeError('Plate coral root point must be finite');
  }
  const normalScale = Math.max(Math.abs(root_normalVec.x), Math.abs(root_normalVec.y), Math.abs(root_normalVec.z));
  if (![root_normalVec.x, root_normalVec.y, root_normalVec.z].every(Number.isFinite) || normalScale === 0) {
    throw new RangeError('Plate coral root normal must be a finite nonzero vector');
  }

  const randFn = createRng(hashString(seedHash)).next;
  const plateCnt = 1 + Math.floor(randFn() * 3);
  const bottomRadius = randRange({
    a: bottomPlate_minRadius,
    b: bottomPlate_maxRadius,
    randFn,
  });
  const reductionRate = randRange({
    a: plateRadius_minReductionRate,
    b: plateRadius_maxReductionRate,
    randFn,
  });
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const rock = coralBaseRock_generate(seedHash);
  appendGeometry(rock.geometry, positions, normals, indices, ZERO_VEC);
  rock.geometry.dispose();

  const stalkBottom = rock.height * 0.4;
  const stalkTop = rock.height + (plateCnt - 1) * plate_levelSpacing - plate_thickness;
  const stalkGeometry = new THREE.CylinderGeometry(stalk_radius, stalk_radius, stalkTop - stalkBottom, 24);
  appendGeometry(stalkGeometry, positions, normals, indices, new THREE.Vector3(0, (stalkTop + stalkBottom) / 2, 0));
  stalkGeometry.dispose();

  const bumpGeometry = new THREE.SphereGeometry(1, params.reefDetail ? 5 : 8, params.reefDetail ? 3 : 6);
  for (let level = 0; level < plateCnt; level++) {
    addPlate(
      bottomRadius * reductionRate ** level,
      rock.height + level * plate_levelSpacing,
      plate_rimHeight * reductionRate ** level,
      randFn,
      bumpGeometry,
      positions,
      normals,
      indices,
    );
  }
  bumpGeometry.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  const scale = height / geometry.boundingBox!.max.y;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const normal = new THREE.Vector3(
    root_normalVec.x / normalScale,
    root_normalVec.y / normalScale,
    root_normalVec.z / normalScale,
  ).normalize();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(root_pt);
  mesh.quaternion.setFromUnitVectors(UP_DIR, normal);
  return mesh;
}
