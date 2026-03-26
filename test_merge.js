#!/usr/bin/env node
'use strict';

/**
 * test_merge.js — CaptureEngine.mergeFrames 독립 테스트
 *
 * data/ 폴더의 N장 이미지를 순차 병합:
 *   1+2 → merged12, merged12+3 → merged123, ... → final
 *
 * Usage: node test_merge.js [1.png 2.png 3.png ...]
 *   기본값: data/1.png data/2.png data/3.png data/4.png
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, 'data');

// ───────── Helpers ─────────

function toLum(r, g, b) {
  return (r * 77 + g * 150 + b * 29) >> 8;
}

function toGray(buf, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < buf.length; i += 4, j++) {
    out[j] = toLum(buf[i], buf[i + 1], buf[i + 2]);
  }
  return out;
}

// ───────── Overlap finder ─────────

function findOverlap(bufA, wA, hA, bufB, wB, hB) {
  if (wA !== wB) throw new Error('width mismatch');
  const w = wA;
  const gA = toGray(bufA, w, hA);
  const gB = toGray(bufB, w, hB);

  const minOverlap = 20;
  const maxOverlap = Math.min(hA, hB) - 20;
  const xStep = 2;

  let bestOv = 0;
  let bestErr = Infinity;

  for (let ov = minOverlap; ov <= maxOverlap; ov++) {
    const aStartRow = hA - ov;
    let totalDiff = 0;
    let samples = 0;

    for (let r = 0; r < ov; r += 2) {
      const rowA = aStartRow + r;
      const rowB = r;
      for (let x = 0; x < w; x += xStep) {
        const diff = gA[rowA * w + x] - gB[rowB * w + x];
        totalDiff += diff * diff;
        samples++;
      }
    }

    const rmsErr = Math.sqrt(totalDiff / samples);
    if (rmsErr < bestErr) {
      bestErr = rmsErr;
      bestOv = ov;
    }
  }

  return { overlapPx: bestOv, error: bestErr };
}

// ───────── mergeFrames (ported from CaptureEngine) ─────────

function mergeFrames(bufA, w, hA, bufB, hB, overlapPx) {
  const FEATHER_RADIUS = 5;
  const SMOOTH_W = 3;
  const overlapStartA = hA - overlapPx;

  // Step 1: Score each row in overlap
  const scores = new Float32Array(overlapPx);
  const rowAvgs = new Float32Array(overlapPx);

  for (let r = 0; r < overlapPx; r++) {
    const rowInA = overlapStartA + r;
    const rowInB = r;
    let diffSum = 0, brightSum = 0;

    for (let x = 0; x < w; x += 2) {
      const iA = (rowInA * w + x) * 4;
      const iB = (rowInB * w + x) * 4;
      const lumA = toLum(bufA[iA], bufA[iA + 1], bufA[iA + 2]);
      const lumB = toLum(bufB[iB], bufB[iB + 1], bufB[iB + 2]);
      const d = lumA - lumB;
      diffSum += d * d;
      brightSum += lumA;
    }
    const samples = Math.ceil(w / 2);
    const avgBright = brightSum / samples;
    rowAvgs[r] = avgBright;

    let varSum = 0;
    for (let x = 0; x < w; x += 4) {
      const iA = (rowInA * w + x) * 4;
      const lumA = toLum(bufA[iA], bufA[iA + 1], bufA[iA + 2]);
      const dv = lumA - avgBright;
      varSum += dv * dv;
    }
    const rowVar = varSum / Math.ceil(w / 4);
    const crossDiff = Math.sqrt(diffSum / samples);
    scores[r] = crossDiff + 0.5 * rowVar;
  }

  // Step 2: Smooth
  const smoothed = new Float32Array(overlapPx);
  for (let r = 0; r < overlapPx; r++) {
    let sum = 0, cnt = 0;
    for (let k = -SMOOTH_W; k <= SMOOTH_W; k++) {
      const idx = r + k;
      if (idx >= 0 && idx < overlapPx) { sum += scores[idx]; cnt++; }
    }
    smoothed[r] = sum / cnt;
  }

  // Step 3: Best seam
  const margin = Math.max(3, Math.floor(overlapPx * 0.1));
  let bestRow = Math.floor(overlapPx / 2);
  let bestScore = Infinity;
  for (let r = margin; r < overlapPx - margin; r++) {
    if (smoothed[r] < bestScore) {
      bestScore = smoothed[r];
      bestRow = r;
    }
  }

  // Step 4: Assemble
  const cutA = overlapStartA + bestRow;
  const cutB = bestRow;
  const outH = cutA + (hB - cutB);
  const outBuf = Buffer.alloc(w * outH * 4);

  // Copy A above seam
  const aEnd = Math.max(0, cutA - FEATHER_RADIUS);
  const aBytes = aEnd * w * 4;
  bufA.copy(outBuf, 0, 0, aBytes);

  // Feather blend
  const blendStart = Math.max(0, cutA - FEATHER_RADIUS);
  const blendEnd = Math.min(Math.min(hA, cutA + FEATHER_RADIUS), hB + overlapStartA);
  for (let r = blendStart; r < blendEnd; r++) {
    const rB = r - overlapStartA;
    if (rB < 0 || rB >= hB) {
      const off = r * w * 4;
      bufA.copy(outBuf, off, off, off + w * 4);
      continue;
    }
    const alpha = (r - blendStart) / (blendEnd - blendStart);
    const offOut = r * w * 4;
    const offA = r * w * 4;
    const offB = rB * w * 4;
    for (let x = 0; x < w * 4; x++) {
      outBuf[offOut + x] = Math.round(bufA[offA + x] * (1 - alpha) + bufB[offB + x] * alpha);
    }
  }

  // Copy B below seam
  let bStart = cutB + FEATHER_RADIUS;
  if (bStart < 0) bStart = 0;
  const outOffset = (cutA + FEATHER_RADIUS) * w * 4;
  const bOffset = bStart * w * 4;
  const bBytes = (hB - bStart) * w * 4;
  if (outOffset >= 0 && bOffset >= 0 && bBytes > 0) {
    bufB.copy(outBuf, outOffset, bOffset, bOffset + bBytes);
  }

  return { outBuf, outW: w, outH, seamRow: bestRow, seamScore: bestScore };
}

// ───────── Main ─────────

async function main() {
  // Parse args or use defaults
  let files = process.argv.slice(2);
  if (files.length === 0) {
    files = ['1.png', '2.png', '3.png', '4.png'];
  }
  files = files.map(f => path.isAbsolute(f) ? f : path.join(DATA, f));

  // Verify all exist and same width
  console.log(`Merging ${files.length} images...`);
  const metas = [];
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1); }
    const m = await sharp(f).metadata();
    metas.push(m);
    console.log(`  ${path.basename(f)}: ${m.width}x${m.height}`);
  }
  const w = metas[0].width;
  for (let i = 1; i < metas.length; i++) {
    if (metas[i].width !== w) {
      console.error(`Width mismatch: ${path.basename(files[0])} is ${w}px, ${path.basename(files[i])} is ${metas[i].width}px`);
      process.exit(1);
    }
  }

  // Load first image as accumulator
  let acc = await sharp(files[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let accBuf = acc.data;
  let accW = acc.info.width;
  let accH = acc.info.height;

  const seamPositions = []; // track seam Y positions in final image for debug overlay

  // Sequential merge: acc + next → acc
  for (let i = 1; i < files.length; i++) {
    const next = await sharp(files[i]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const nextBuf = next.data;
    const nextH = next.info.height;

    console.log(`\n── Merge step ${i}: acc(${accW}x${accH}) + ${path.basename(files[i])}(${accW}x${nextH}) ──`);

    // Find overlap
    const { overlapPx, error } = findOverlap(accBuf, accW, accH, nextBuf, accW, nextH);
    console.log(`  overlap: ${overlapPx}px  (RMS=${error.toFixed(2)})`);

    if (overlapPx < 10) {
      console.warn(`  WARNING: tiny overlap ${overlapPx}px — concatenating without merge`);
      // Simple concat
      const newH = accH + nextH;
      const newBuf = Buffer.alloc(accW * newH * 4);
      accBuf.copy(newBuf, 0, 0, accBuf.length);
      nextBuf.copy(newBuf, accBuf.length, 0, nextBuf.length);
      accBuf = newBuf;
      accH = newH;
      continue;
    }

    // Merge
    const { outBuf, outH, seamRow, seamScore } = mergeFrames(accBuf, accW, accH, nextBuf, nextH, overlapPx);
    const seamY = (accH - overlapPx) + seamRow;
    seamPositions.push(seamY);
    console.log(`  seam: row ${seamRow}/${overlapPx}  score=${seamScore.toFixed(1)}  → output ${accW}x${outH}  (seamY=${seamY})`);

    accBuf = outBuf;
    accH = outH;
  }

  console.log(`\n── Final: ${accW}x${accH} ──`);

  // Save merged result
  const outPath = path.join(DATA, 'merged.png');
  await sharp(accBuf, { raw: { width: accW, height: accH, channels: 4 } })
    .png()
    .toFile(outPath);
  const stat = fs.statSync(outPath);
  console.log(`Saved: ${outPath} (${(stat.size / 1024).toFixed(0)} KB)`);

  // Save debug version with seam lines
  const debugBuf = Buffer.from(accBuf);
  for (const sy of seamPositions) {
    for (let dy = -1; dy <= 1; dy++) {
      const row = sy + dy;
      if (row < 0 || row >= accH) continue;
      for (let x = 0; x < accW; x++) {
        const off = (row * accW + x) * 4;
        debugBuf[off] = 0;
        debugBuf[off + 1] = 255;
        debugBuf[off + 2] = 0;
        debugBuf[off + 3] = 255;
      }
    }
  }
  const debugPath = path.join(DATA, 'merged_debug.png');
  await sharp(debugBuf, { raw: { width: accW, height: accH, channels: 4 } })
    .png()
    .toFile(debugPath);
  console.log(`Debug: ${debugPath} (${seamPositions.length} seam lines marked)`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
