/*!
 * ししゅまお - lineart.js
 * 画像から輪郭・線だけを取り出して「白背景＋黒線」の下絵をつくる処理群。
 * 外部ライブラリなし / すべて端末内で完結（画像はどこにも送信しません）。
 */
(function (global) {
  'use strict';

  /* ---------- 基本ユーティリティ ---------- */

  // ImageData -> グレースケール(0..255 / 透明は白として合成)
  function toGray(imageData) {
    var d = imageData.data, n = imageData.width * imageData.height;
    var out = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var a = d[j + 3] / 255;
      var v = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      out[i] = v * a + 255 * (1 - a);
    }
    return out;
  }

  // 明るさ・コントラスト補正（contrast: 0=なし, 1=強め）
  function applyContrast(src, amount) {
    if (amount <= 0) return src;
    var n = src.length, out = new Float32Array(n);
    var c = 1 + amount * 1.6;
    for (var i = 0; i < n; i++) {
      var v = (src[i] - 128) * c + 128;
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return out;
  }

  // 箱ぼかし（横→縦の分離型・端はクランプ）
  function boxBlur(src, w, h, r) {
    if (r < 1) return src;
    var tmp = new Float32Array(src.length);
    var out = new Float32Array(src.length);
    var i, x, y, sum, win = r * 2 + 1;

    for (y = 0; y < h; y++) {
      var row = y * w;
      sum = src[row] * (r + 1);
      for (i = 1; i <= r; i++) sum += src[row + Math.min(i, w - 1)];
      for (x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
      }
    }
    for (x = 0; x < w; x++) {
      sum = tmp[x] * (r + 1);
      for (i = 1; i <= r; i++) sum += tmp[Math.min(i, h - 1) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        sum += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
      }
    }
    return out;
  }

  // ガウスぼかし近似（箱ぼかし3回）
  function blur(src, w, h, sigma) {
    if (sigma < 0.4) return src;
    var r = Math.max(1, Math.round(sigma * 1.1));
    return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
  }

  // 正の値のうち「上位 keep（0..1）」に入るしきい値を返す
  function thresholdFor(values, keep) {
    var BINS = 1024, hist = new Uint32Array(BINS), n = values.length, max = 0, i, v, count = 0;
    for (i = 0; i < n; i++) { v = values[i]; if (v > max) max = v; }
    if (max <= 0) return Infinity;
    for (i = 0; i < n; i++) {
      v = values[i];
      if (v > 0) { hist[Math.min(BINS - 1, (v / max * (BINS - 1)) | 0)]++; count++; }
    }
    var target = count * Math.min(1, Math.max(0.0005, keep)), acc = 0;
    for (i = BINS - 1; i >= 0; i--) {
      acc += hist[i];
      if (acc >= target) return (i / (BINS - 1)) * max;
    }
    return 0;
  }

  /* ---------- モード1: なめらか線画（DoG） ---------- */
  // イラスト・写真の「描き起こしたような線」に向く
  function sketch(gray, w, h, opt) {
    var g1 = blur(gray, w, h, opt.sigma);
    var g2 = blur(gray, w, h, opt.sigma * 2.2);
    var n = w * h, diff = new Float32Array(n), i;
    for (i = 0; i < n; i++) diff[i] = g2[i] - g1[i]; // 暗い側（線）で正
    var t = thresholdFor(diff, 0.02 + opt.density * 0.30);
    t = Math.max(t, 1.0);
    var bin = new Uint8Array(n);
    for (i = 0; i < n; i++) bin[i] = diff[i] > t ? 1 : 0;
    return bin;
  }

  /* ---------- モード2: くっきり輪郭（Canny） ---------- */
  function outline(gray, w, h, opt) {
    var g = blur(gray, w, h, Math.max(0.6, opt.sigma));
    var n = w * h;
    var mag = new Float32Array(n), dir = new Uint8Array(n);
    var x, y, i;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        var a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
        var d = g[i - 1], f = g[i + 1];
        var p = g[i + w - 1], q = g[i + w], r = g[i + w + 1];
        var gx = (c + 2 * f + r) - (a + 2 * d + p);
        var gy = (p + 2 * q + r) - (a + 2 * b + c);
        mag[i] = Math.sqrt(gx * gx + gy * gy);
        var ang = Math.atan2(gy, gx) * 180 / Math.PI;
        if (ang < 0) ang += 180;
        dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
      }
    }
    // 非極大抑制（線を1px幅に絞る）
    var nms = new Float32Array(n);
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        var m = mag[i], m1, m2;
        switch (dir[i]) {
          case 0: m1 = mag[i - 1]; m2 = mag[i + 1]; break;
          case 1: m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; break;
          case 2: m1 = mag[i - w]; m2 = mag[i + w]; break;
          default: m1 = mag[i - w + 1]; m2 = mag[i + w - 1];
        }
        nms[i] = (m >= m1 && m >= m2) ? m : 0;
      }
    }
    // ヒステリシスしきい値
    var high = thresholdFor(nms, 0.03 + opt.density * 0.40);
    high = Math.max(high, 6);
    var low = high * 0.4;
    var bin = new Uint8Array(n);
    var stack = new Int32Array(n), sp = 0;
    for (i = 0; i < n; i++) if (nms[i] >= high) { bin[i] = 1; stack[sp++] = i; }
    while (sp > 0) {
      var p0 = stack[--sp];
      var px = p0 % w, py = (p0 / w) | 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (!bin[ni] && nms[ni] >= low) { bin[ni] = 1; stack[sp++] = ni; }
        }
      }
    }
    return bin;
  }

  /* ---------- モード3: 文字・スクショ（適応的2値化） ---------- */
  // スクリーンショットやロゴ、文字入りの画像に強い
  function flat(gray, w, h, opt) {
    var g = blur(gray, w, h, opt.sigma * 0.5);
    var n = w * h;
    // 積分画像
    var integ = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var rowSum = 0;
      for (var x = 0; x < w; x++) {
        rowSum += g[y * w + x];
        integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + rowSum;
      }
    }
    var rad = Math.max(4, Math.round(Math.min(w, h) * 0.035));
    var c = 22 - opt.density * 18; // density が高いほど細かく拾う
    var bin = new Uint8Array(n);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
        var area = (x1 - x0 + 1) * (y1 - y0 + 1);
        var sum = integ[(y1 + 1) * (w + 1) + (x1 + 1)] - integ[y0 * (w + 1) + (x1 + 1)]
                - integ[(y1 + 1) * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        var mean = sum / area;
        bin[y * w + x] = g[y * w + x] < mean - c ? 1 : 0;
      }
    }
    return bin;
  }

  /* ---------- 後処理 ---------- */

  // 小さすぎる点（ノイズ）を消す
  function despeckle(bin, w, h, minSize) {
    if (minSize <= 1) return bin;
    var n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n);
    var comp = new Int32Array(n);
    for (var s = 0; s < n; s++) {
      if (!bin[s] || seen[s]) continue;
      var sp = 0, cn = 0;
      stack[sp++] = s; seen[s] = 1;
      while (sp > 0) {
        var p = stack[--sp];
        comp[cn++] = p;
        var px = p % w, py = (p / w) | 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            var ni = ny * w + nx;
            if (bin[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni; }
          }
        }
      }
      if (cn < minSize) for (var k = 0; k < cn; k++) bin[comp[k]] = 0;
    }
    return bin;
  }

  // 線を太くする（3x3 最大値フィルタ）
  function dilate(bin, w, h, times) {
    for (var t = 0; t < times; t++) {
      var out = new Uint8Array(bin.length);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = y * w + x;
          if (bin[i]) { out[i] = 1; continue; }
          var on = 0;
          for (var dy = -1; dy <= 1 && !on; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              if (bin[ny * w + nx]) { on = 1; break; }
            }
          }
          out[i] = on;
        }
      }
      bin = out;
    }
    return bin;
  }

  // 2値配列 -> 白背景＋黒線の ImageData
  function toImageData(bin, w, h, invert) {
    var img = new ImageData(w, h), d = img.data;
    var bg = invert ? 0 : 255, fg = invert ? 255 : 0;
    for (var i = 0, j = 0; i < bin.length; i++, j += 4) {
      var v = bin[i] ? fg : bg;
      d[j] = d[j + 1] = d[j + 2] = v;
      d[j + 3] = 255;
    }
    return img;
  }

  /* ---------- 入口 ---------- */
  /**
   * @param {ImageData} imageData 元画像
   * @param {Object} o {mode:'sketch'|'outline'|'flat', density:0..1, detail:0..1,
   *                    thickness:1..4, denoise:0..1, contrast:0..1, invert:bool}
   * @returns {ImageData} 白背景＋黒線
   */
  function process(imageData, o) {
    var w = imageData.width, h = imageData.height;
    var gray = applyContrast(toGray(imageData), o.contrast || 0);
    var opt = {
      sigma: 0.3 + (1 - (o.detail == null ? 0.5 : o.detail)) * 3.0, // detail 高 = ぼかし弱
      density: o.density == null ? 0.5 : o.density
    };
    var bin;
    if (o.mode === 'outline') bin = outline(gray, w, h, opt);
    else if (o.mode === 'flat') bin = flat(gray, w, h, opt);
    else bin = sketch(gray, w, h, opt);

    // 解像度が上がっても線が細くなりすぎないように、基準の太さを画像サイズから決める
    var long = Math.max(w, h);
    var unit = Math.min(3, Math.max(1, Math.round(long / 800)));
    // Canny は 1px の線になるので、輪郭モードだけ基準を太めに
    var base = o.mode === 'outline' ? Math.min(3, Math.max(1, Math.round(long / 550))) : unit;
    var minSize = Math.round((o.denoise || 0) * 120 * base);
    bin = despeckle(bin, w, h, minSize);
    var th = Math.max(1, Math.round(o.thickness || 1));
    var iterations = (base - 1) + (th - 1) * unit;
    if (iterations > 0) bin = dilate(bin, w, h, iterations);
    return toImageData(bin, w, h, !!o.invert);
  }

  global.LineArt = { process: process };
})(window);
