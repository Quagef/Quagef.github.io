/**
 * 小诗卡片渲染 + 横向滑动流动线
 *
 * 依赖：script/poems.js 已把 26 首诗挂到 window.POEMS（在 app.js 之前同步加载，
 * 保证 app.js 里的 od() 初始化时能 querySelectorAll 到这些卡片，翻牌交互照常工作）。
 *
 * 本脚本做三件事：
 *   1. 用 window.POEMS 渲染卡片（不再在 index.html 里硬编码文本）。
 *   2. 奇数卡做高低错落（is-low），形成波浪起伏。
 *   3. 生成一根黑线，用「圆角折线」穿过每张卡左上角的 .card-front__hole：
 *      相邻小孔之间是清晰的斜线（像一根绷直的线把卡片串起来），只在每个小孔处做圆角拐弯，
 *      这样缝隙里能看到连接两张卡的斜线，而不是被压平的波浪。
 *      线用 SVG mask 控制露/藏：进入小孔前（卡片左侧）线露在卡片上面，穿过小孔后线
 *      被卡片遮住（藏在右半边下面），到下一张卡左侧又重新露出来——一前一后穿梭，
 *      视觉上是一根线把卡片串起来（穿起来的卡片）。
 *      遮线的黑色矩形严格按卡片真实矩形（含高度）来画，保证线爬出低卡右上角后的
 *      悬空段仍然显示，不会出现“悬空没线”的断口。
 *      并绑定 .index-projects__inner 的横向滚动，用 stroke-dashoffset 让线随左右滑动“画”出来。
 */
(function () {
    'use strict';

    var data = window.POEMS;
    var list = document.querySelector('.index-projects__list');
    if (!data || !data.length || !list) return;

    var SVGNS = 'http://www.w3.org/2000/svg';
    var MASK_ID = 'poem-line-mask';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 正文里的 \n 换成 <br>（先转义再换行，避免注入）
    function nl2br(s) {
        return String(s == null ? '' : s).split('\n').map(esc).join('<br>');
    }

    // ---------- 1. 渲染卡片 ----------
    var html = data.map(function (p, i) {
        var low = i % 2 === 1 ? ' is-low' : '';
        var name = p.name
            ? '<h3 class="card-front__desc__name">' + nl2br(p.name) + '</h3>'
            : '';
        return '<li class="index-projects__item js-card-item' + low + '">' +
            '<div class="index-projects__item__wrapper">' +
                '<article class="card-front js-card-front" data-type="index">' +
                    '<div class="card-front__hover">' +
                        '<a href="' + esc(p.url) + '" class="hover-shadow-text">' +
                            '<div class="card-front__grid">' +
                                '<div class="card-front__hole"></div>' +
                                '<div class="card-front__top">' +
                                    '<span class="card-front__top__client">' + esc(p.date) + '</span>' +
                                    '<h2 class="card-front__top__title">' + esc(p.title) + '</h2>' +
                                '</div>' +
                                '<div class="card-front__desc">' +
                                    name +
                                    '<p class="card-front__desc__text">' + nl2br(p.text) + '</p>' +
                                    '<div class="arrow-button__link">' +
                                        '<div class="arrow-button__link__icon">' +
                                            '<svg class="svg-sprited svg-view-detail" role="img" aria-label=""><use xlink:href="#view-detail"></use></svg>' +
                                        '</div>' +
                                        '<span class="arrow-button__link__dot"></span>' +
                                        '<span class="arrow-button__link__text shadow-text">View Detail</span>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="card-front__image">' +
                                    '<img src="' + esc(p.cover) + '" width="210" height="80" decoding="async" alt="">' +
                                '</div>' +
                            '</div>' +
                        '</a>' +
                    '</div>' +
                '</article>' +
                '<div class="card-back js-card-back">' +
                    '<div class="card-back__hover">' +
                        '<div class="card-back__hole"></div>' +
                        '<div class="card-back__top">' +
                            '<p class="card-back__top__text">LOOKING BACK</p>' +
                            '<div class="card-back__btn">' +
                                '<span class="card-back__btn__circle"></span>' +
                                '<span class="card-back__btn__circle"></span>' +
                                '<span class="card-back__btn__circle"></span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="card-back__desc">' +
                            '<h3 class="card-back__desc__title">' + esc(p.backTitle || p.title) + '</h3>' +
                            '<p class="card-back__desc__text">' + esc(p.backText || '') + '</p>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</li>';
    }).join('');

    list.innerHTML = html;

    // ---------- 2. 生成穿过小孔的流动线 ----------
    var inner = list.closest('.index-projects__inner') || list.parentElement;
    var lineSvg = null;
    var linePath = null;
    var lineLen = 0;

    // 圆角折线：把小孔中心用「直线斜向」连接起来，只在每个小孔处做圆角过渡。
    // 这样缝隙里的线段是清晰的斜线（像一根绷直的线把卡片串起来），而不是在孔处被
    // 压平的波浪（那种会让斜向的穿线都藏在卡片里、缝隙只剩一小段接近水平的短线）。
    function roundedPath(pts, r) {
        if (!pts.length) return '';
        if (pts.length === 1) return 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
        var n = pts.length;
        var d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
        for (var i = 0; i < n - 1; i++) {
            var p = pts[i];
            var q = pts[i + 1];
            var dx = q.x - p.x;
            var dy = q.y - p.y;
            var L = Math.sqrt(dx * dx + dy * dy) || 1;
            var ux = dx / L;
            var uy = dy / L;
            // 本段直线终点：若 q 是内部点，则停在 q 的圆角起点（q - u*r）；末点不圆角
            var ex = i < n - 2 ? q.x - ux * r : q.x;
            var ey = i < n - 2 ? q.y - uy * r : q.y;
            d += ' L ' + ex.toFixed(1) + ' ' + ey.toFixed(1);
            // 在内部点 q 处做圆角（二次贝塞尔），控制点取 2q - (起+终)/2，
            // 使曲线在 t=0.5 时正好穿过小孔中心 q，而不是只“擦过”孔的上沿。
            if (i < n - 2) {
                var q2 = pts[i + 2];
                var dx2 = q2.x - q.x;
                var dy2 = q2.y - q.y;
                var L2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
                var sx = q.x + (dx2 / L2) * r;
                var sy = q.y + (dy2 / L2) * r;
                var cx = 2 * q.x - (ex + sx) / 2;
                var cy = 2 * q.y - (ey + sy) / 2;
                d += ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ', ' +
                    sx.toFixed(1) + ' ' + sy.toFixed(1);
            }
        }
        return d;
    }

    // 构建 mask：白底（全部显示），只有「卡片本身」需要遮住线的区域涂黑（隐藏），
    // 小孔处画白色圆（显示，作为“针脚”）。
    // 关键点：遮住线的黑色矩形必须用卡片的真实矩形（x 和 y 都按卡片边界），而不是
    // 一条贯穿全高的 x 条带——否则线在低卡右上角“爬出”卡片顶部之后的那段（悬空段）
    // 会被误当成“在卡片上”而一起遮掉，出现悬空没线。
    function buildMask(holeRects, cardRects, W, H) {
        var mask = document.createElementNS(SVGNS, 'mask');
        mask.setAttribute('id', MASK_ID);
        mask.setAttribute('maskUnits', 'userSpaceOnUse');
        mask.setAttribute('x', '0');
        mask.setAttribute('y', '0');
        mask.setAttribute('width', W);
        mask.setAttribute('height', H);

        // 白底：线默认全部显示（缝隙、悬空段、卡片前面都显示）
        var bg = document.createElementNS(SVGNS, 'rect');
        bg.setAttribute('x', '0');
        bg.setAttribute('y', '0');
        bg.setAttribute('width', W);
        bg.setAttribute('height', H);
        bg.setAttribute('fill', '#fff');
        mask.appendChild(bg);

        // 每张卡：小孔右侧（从小孔中心到卡片右边缘）的卡片矩形涂黑，把线藏在卡片后面；
        // 用 card.top/bottom 限定高度，这样线爬出卡片顶部后就恢复显示。
        for (var k = 0; k < holeRects.length; k++) {
            var h = holeRects[k];
            var card = cardRects[k];
            var rightW = Math.max(0, card.right - h.cx);
            var ch = Math.max(0, card.bottom - card.top);
            if (rightW <= 0 || ch <= 0) continue;
            var rect = document.createElementNS(SVGNS, 'rect');
            rect.setAttribute('x', h.cx.toFixed(1));
            rect.setAttribute('y', card.top.toFixed(1));
            rect.setAttribute('width', rightW.toFixed(1));
            rect.setAttribute('height', ch.toFixed(1));
            rect.setAttribute('fill', '#000');
            mask.appendChild(rect);
        }

        // 小孔处白色圆，作为线穿过卡片的“针脚”
        for (var j = 0; j < holeRects.length; j++) {
            var h = holeRects[j];
            var c = document.createElementNS(SVGNS, 'circle');
            c.setAttribute('cx', h.cx.toFixed(1));
            c.setAttribute('cy', h.cy.toFixed(1));
            c.setAttribute('r', (h.r + 1).toFixed(1));
            c.setAttribute('fill', '#fff');
            mask.appendChild(c);
        }

        return mask;
    }

    function buildLine() {
        var holes = list.querySelectorAll('.card-front__hole');
        var items = list.querySelectorAll('.index-projects__item');
        if (!holes.length || !items.length) return;

        var listRect = list.getBoundingClientRect();
        var W = list.scrollWidth || listRect.width;
        var H = list.scrollHeight || listRect.height;

        // 小孔中心（相对 list）
        var holeRects = [];
        for (var i = 0; i < holes.length; i++) {
            var r = holes[i].getBoundingClientRect();
            holeRects.push({
                cx: r.left - listRect.left + r.width / 2,
                cy: r.top - listRect.top + r.height / 2,
                r: r.width / 2
            });
        }

        // 卡片矩形（相对 list），用于「小孔右侧把线藏在卡片后面」——需要 top/bottom 来
        // 精确限定卡片高度，避免线在卡片顶部之外悬空时被误遮。
        var cardRects = [];
        for (var k = 0; k < items.length; k++) {
            var cr = items[k].getBoundingClientRect();
            cardRects.push({
                left: cr.left - listRect.left,
                right: cr.right - listRect.left,
                top: cr.top - listRect.top,
                bottom: cr.bottom - listRect.top
            });
        }

        // 缝隙 x 范围（相邻卡片之间）
        var gapRects = [];
        for (var j = 0; j < items.length - 1; j++) {
            var a = items[j].getBoundingClientRect();
            var b = items[j + 1].getBoundingClientRect();
            gapRects.push({ x: a.right - listRect.left, w: b.left - a.right });
        }

        var pts = holeRects.map(function (h) { return { x: h.cx, y: h.cy }; });

        // 圆角半径：取缝隙平均宽度的一定比例，让斜线能铺满缝隙、又在小孔处平滑拐弯
        var avgGap = 0;
        for (var g = 0; g < gapRects.length; g++) avgGap += gapRects[g].w;
        avgGap = gapRects.length ? avgGap / gapRects.length : 0;
        var radius = Math.max(8, Math.min(avgGap * 0.4, 24));

        var d = roundedPath(pts, radius);

        // 重建 svg（load / resize 时会重新测量）
        if (lineSvg && lineSvg.parentNode) {
            lineSvg.parentNode.removeChild(lineSvg);
        }

        lineSvg = document.createElementNS(SVGNS, 'svg');
        lineSvg.setAttribute('class', 'index-projects__line');
        lineSvg.setAttribute('width', W);
        lineSvg.setAttribute('height', H);
        lineSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

        var defs = document.createElementNS(SVGNS, 'defs');
        defs.appendChild(buildMask(holeRects, cardRects, W, H));
        lineSvg.appendChild(defs);

        linePath = document.createElementNS(SVGNS, 'path');
        linePath.setAttribute('d', d);
        linePath.setAttribute('fill', 'none');
        linePath.setAttribute('stroke', '#101010');
        linePath.setAttribute('stroke-width', '0.8');
        linePath.setAttribute('stroke-linecap', 'round');
        linePath.setAttribute('stroke-linejoin', 'round');
        linePath.setAttribute('mask', 'url(#' + MASK_ID + ')');
        lineSvg.appendChild(linePath);

        list.insertBefore(lineSvg, list.firstChild);

        lineLen = linePath.getTotalLength();
        linePath.style.strokeDasharray = String(lineLen);
        linePath.style.strokeDashoffset = String(lineLen);

        updateLine();
    }

    // 横向滚动：线的右端始终停在「当前视口右边缘」，
    // 即已画出的部分 = 从最左到 (scrollLeft + clientWidth) 这一段，随左右滑动延伸/收回。
    function updateLine() {
        if (!linePath || !lineLen) return;
        var sw = inner.scrollWidth;
        var cw = inner.clientWidth;
        var p = sw > 0 ? Math.min(1, (inner.scrollLeft + cw) / sw) : 0;
        linePath.style.strokeDashoffset = String(lineLen * (1 - p));
    }

    buildLine();

    if (inner) {
        inner.addEventListener('scroll', updateLine, { passive: true });
    }

    // 视口尺寸变化（跨 PC/SP 断点）时重建线
    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(buildLine, 150);
    });
    window.addEventListener('load', buildLine);
})();
