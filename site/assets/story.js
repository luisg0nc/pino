// pino stories: a board made in a few turns of the loop, drawn the way pino's Board view draws it.
// A story is a list of steps (what you said, and the lines pino said back as each build or route landed) and the
// board's data (stories/<name>.board.js, made by app/scripts/story-board.mjs from the project's own builds and
// routes). Each line names the build or route it shows; the engine types the prompts, moves the board from each state
// to the next and draws it in SVG. With motion reduced it shows the last state and the whole conversation.
;(function () {
  'use strict'
  var NS = 'http://www.w3.org/2000/svg'
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function svg(name, attrs, parent) {
    var e = document.createElementNS(NS, name)
    for (var k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }
  function html(tag, cls, parent, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x }
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
  function mix(a, b, t) { return a + (b - a) * t }
  // The shorter way round from one angle to the next, in degrees.
  function turnTo(a, b, t) { return a + ((((b - a) % 360) + 540) % 360 - 180) * t }

  // A state of the board: { build, route, stale, errors }, the build and route by the names the board's data gives
  // them. A route that kept another's copper is drawn with that copper: it does not arrive again.
  function copperOf(data, route) {
    var r = route && data.routes[route]
    return r ? (typeof r.tracks === 'string' ? r.tracks : route) : null
  }
  function pourOf(data, s) {
    if (s.route) { var p = data.routes[s.route].pour; return 'r:' + (typeof p === 'string' ? p : s.route) }
    return s.build ? 'b:' + s.build : null
  }
  function set(el, k, v) { if (el['_' + k] !== v) { el.setAttribute(k, v); el['_' + k] = v } }
  function op(el, v) { set(el, 'opacity', v >= 0.999 ? '1' : v <= 0.001 ? '0' : v.toFixed(3)) }

  // The board as pino's Board view draws it with the top copper looked at: the paper inside the outline, the bottom's
  // pour hatched and its tracks in pencil, the top's tracks and every pad in graphite, vias as paper discs with a ring,
  // the silk and the references, the outline, and the ratsnest dashed over it all. In the board file's millimetres,
  // y down, as the data is.
  function drawing(view, data) {
    var b = data.box, M = 2.5, ns = 'story-' + Math.random().toString(36).slice(2, 8)
    var s = svg('svg', { class: 'story-svg', viewBox: [b[0] - M, b[1] - M, b[2] - b[0] + 2 * M, b[3] - b[1] + 2 * M].join(' '), 'aria-hidden': 'true' }, view)
    var defs = svg('defs', {}, s)
    var hatch = svg('pattern', { id: ns + 'h', patternUnits: 'userSpaceOnUse', width: 0.42, height: 0.42, patternTransform: 'rotate(45)' }, defs)
    svg('line', { class: 'sb-hatch', x1: 0.21, y1: 0, x2: 0.21, y2: 0.42 }, hatch)
    svg('path', { d: data.edge }, svg('clipPath', { id: ns + 'c' }, defs))
    var root = svg('g', {}, s)
    var grid = '', g
    for (g = Math.ceil((b[0] - M) / 2.5) * 2.5; g <= b[2] + M; g += 2.5) grid += 'M' + g + ' ' + (b[1] - M) + 'V' + (b[3] + M)
    for (g = Math.ceil((b[1] - M) / 2.5) * 2.5; g <= b[3] + M; g += 2.5) grid += 'M' + (b[0] - M) + ' ' + g + 'H' + (b[2] + M)
    svg('path', { class: 'story-grid', d: grid }, root)
    var board = svg('g', {}, root)
    var paper = svg('path', { class: 'sb-paper', d: data.edge }, board)
    var inside = svg('g', { 'clip-path': 'url(#' + ns + 'c)' }, board)

    var pours = {}
    var pour = function (key, list) {
      var pg = svg('g', { class: 'sb-pour', fill: 'url(#' + ns + 'h)', opacity: 0 }, inside)
      list.forEach(function (p) { svg('path', { d: p.d }, pg) })
      pours[key] = pg
    }
    Object.keys(data.builds).forEach(function (n) { pour('b:' + n, data.builds[n].pour) })
    Object.keys(data.routes).forEach(function (n) { if (typeof data.routes[n].pour !== 'string') pour('r:' + n, data.routes[n].pour) })

    // A route's copper: the tracks in the order they arrive, each run a path one long, so that it is drawn in by its dash.
    var copper = {}
    Object.keys(data.routes).forEach(function (n) {
      var r = data.routes[n]
      if (typeof r.tracks === 'string') return
      var cg = svg('g', { class: 'sb-copper', opacity: 0 }, inside)
      var back = svg('g', { class: 'sb-back' }, cg), front = svg('g', { class: 'sb-front' }, cg)
      var tracks = r.tracks.map(function (t) {
        return svg('path', { class: 'sb-track', d: t.d, 'stroke-width': t.w, pathLength: 1 }, t.layer === 'B.Cu' ? back : front)
      })
      var vias = svg('g', { class: 'sb-vias' }, cg)
      r.vias.forEach(function (v) { svg('circle', { class: 'sb-via', cx: v[0], cy: v[1], r: v[2] }, vias); svg('circle', { class: 'sb-drill', cx: v[0], cy: v[1], r: v[3] }, vias) })
      copper[n] = { g: cg, tracks: tracks, vias: vias, reveal: -1 }
    })

    // The parts: each footprint it has had in its own frame, moved and turned to its pose.
    var refs = [], parts = {}
    Object.keys(data.shapes).forEach(function (key) {
      var ref = key.split('/')[0]
      if (!parts[ref]) { refs.push(ref); parts[ref] = { g: svg('g', { class: 'sb-part', opacity: 0 }, inside), shapes: {} } }
      var sg = svg('g', {}, parts[ref].g), sh = data.shapes[key]
      if (sh.silk) svg('path', { class: 'sb-silk', d: sh.silk }, sg)
      svg('path', { class: 'sb-pad', d: sh.pads }, sg)
      sh.holes.forEach(function (h) { svg('circle', { class: 'sb-hole', cx: h[0], cy: h[1], r: h[2] }, sg) })
      parts[ref].shapes[key] = sg
    })
    refs.sort()
    var labels = {}
    refs.forEach(function (ref) { labels[ref] = svg('text', { class: 'sb-label', opacity: 0 }, inside); labels[ref].textContent = ref })

    svg('path', { class: 'sb-edge', d: data.edge }, board)
    var rats = {}
    Object.keys(data.builds).forEach(function (n) { rats[n] = svg('path', { class: 'sb-rat', d: data.builds[n].rats, opacity: 0 }, board) })
    var errors = {}
    Object.keys(data.routes).forEach(function (n) {
      var eg = svg('g', { class: 'sb-errors', opacity: 0 }, board)
      data.routes[n].errors.forEach(function (e) { svg('circle', { cx: e[0], cy: e[1], r: 0.9 }, eg) })
      errors[n] = eg
    })

    function draw(A, B, p) {
      var e = ease(clamp(p, 0, 1)), arriving = !A.build && B.build
      // Coming in: the outline, then the parts one after another, then the ratsnest.
      var w = arriving ? clamp((p - 0.75) / 0.25, 0, 1) : e
      op(board, A.build ? 1 : B.build ? clamp(e * 3, 0, 1) : 0)
      var fromB = A.build && data.builds[A.build], toB = B.build && data.builds[B.build]
      refs.forEach(function (ref, i) {
        var pa = fromB && fromB.parts[ref], pb = toB && toB.parts[ref], P = parts[ref], L = labels[ref]
        var la = fromB && fromB.labels[ref], lb = toB && toB.labels[ref]
        var pose, opA = 0, opB = 0, k = 1, lab
        if (pa && pb) {
          pose = [mix(pa[0], pb[0], e), mix(pa[1], pb[1], e), turnTo(pa[2], pb[2], e)]
          if (pa[3] === pb[3]) opA = opB = 1; else { opA = 1 - e; opB = e }
          lab = la && lb ? [mix(la[0], lb[0], e), mix(la[1], lb[1], e), turnTo(la[2], lb[2], e), lb[3]] : lb
        } else if (pb) {
          k = ease(clamp((p - 0.2 - (i * 0.45) / refs.length) / 0.25, 0, 1))
          pose = pb; opB = k; lab = lb
        } else if (pa) { pose = pa; opA = 1 - e; k = 1 - e; lab = la }
        else { op(P.g, 0); op(L, 0); return }
        op(P.g, 1)
        var sc = 0.6 + 0.4 * k
        set(P.g, 'transform', 'translate(' + pose[0].toFixed(3) + ' ' + pose[1].toFixed(3) + ') rotate(' + (-pose[2]).toFixed(2) + ')' + (sc < 1 ? ' scale(' + sc.toFixed(3) + ')' : ''))
        for (var key in P.shapes) op(P.shapes[key], pa && key === pa[3] ? opA : pb && key === pb[3] ? opB : 0)
        if (lab) {
          op(L, Math.max(opA, opB) * (pb ? k : 1))
          set(L, 'transform', 'translate(' + lab[0].toFixed(3) + ' ' + lab[1].toFixed(3) + ') rotate(' + (-lab[2]).toFixed(1) + ')')
          set(L, 'font-size', String(lab[3]))
        } else op(L, 0)
      })
      var unrouted = function (s, n) { return s.build === n && !s.route ? 1 : 0 }
      for (var n in rats) op(rats[n], mix(unrouted(A, n), unrouted(B, n), w))
      var pa = pourOf(data, A), pb = pourOf(data, B), stale = mix(A.stale ? 1 : 0, B.stale ? 1 : 0, e)
      for (var key in pours) {
        var v = mix(pa === key ? 1 : 0, pb === key ? 1 : 0, arriving ? w : e)
        op(pours[key], v * (key.charAt(0) === 'r' ? 1 - 0.6 * stale : 1))
      }
      // Copper arrives net by net while it lands; copper that no longer fits fades toward the paper; copper going
      // away leaves in the first part of the next arrival.
      var ca = copperOf(data, A.route), cb = copperOf(data, B.route)
      for (var c in copper) {
        var C = copper[c], reveal = 0, o = 0
        if (ca === c && cb === c) { reveal = 1; o = 1 - 0.6 * stale }
        else if (cb === c) { reveal = clamp(p, 0, 1); o = 1 - 0.6 * (B.stale ? 1 : 0) }
        else if (ca === c) { reveal = 1; o = (1 - clamp(p / 0.4, 0, 1)) * (1 - 0.6 * (A.stale ? 1 : 0)) }
        op(C.g, o)
        if (reveal !== C.reveal) {
          C.reveal = reveal
          var arrived = reveal * C.tracks.length
          C.tracks.forEach(function (el, i) {
            var part = clamp(arrived - i, 0, 1)
            set(el, 'stroke-dasharray', part >= 1 ? 'none' : '1 2')
            set(el, 'stroke-dashoffset', part >= 1 ? '0' : (1 - part).toFixed(3))
          })
          op(C.vias, clamp((reveal - 0.9) / 0.1, 0, 1))
        }
      }
      var flagged = function (s, n) { return s.route === n && s.errors ? 1 : 0 }
      for (var r in errors) op(errors[r], mix(flagged(A, r), flagged(B, r), cb && ca !== cb ? clamp((p - 0.85) / 0.15, 0, 1) : e))
    }

    // What the state is, in pino's own counts.
    function says(st) {
      if (!st.build) return '<span class="num">board.py</span> is not written yet'
      var c = data.builds[st.build].counts
      var t = '<span class="num">' + c.parts + '</span> parts, <span class="num">' + c.nets + '</span> nets'
      if (!st.route) return t + ', <span class="num">' + c.unrouted + '</span> connections to route'
      var r = data.routes[st.route].counts
      t += ', <span class="num">' + r.tracks + '</span> tracks, <span class="num">' + r.vias + '</span> vias, <span class="num">' + r.track_mm + '</span> mm of copper'
      if (st.stale) return t + ': <span class="verdict warn">stale</span>'
      if (r.copper_errors) return t + ': <span class="verdict">' + r.copper_errors + ' copper errors</span>'
      return t + (r.drc_errors ? '' : ': <span class="verdict pass">DRC clean</span>')
    }

    return { root: root, draw: draw, says: says }
  }

  function play(root, story) {
    var data = boards[story.board]
    if (!data) return

    // When each thing happens, in seconds from the start. A line of pino's comes in, then the board goes from the last
    // state to the line's own in `dur` seconds (a build, a route arriving), then `wait` more before the next.
    var t = 1.1, moments = [], state = { build: null, route: null, stale: false, errors: false }
    var said = function (ln) {
      var at = t
      if (ln.state) {
        var to = Object.assign({}, state, ln.state)
        moments.push({ t0: at, t1: at + (ln.dur || 1.5), from: state, to: to, line: ln })
        state = to
      } else moments.push({ t0: at, t1: at + (ln.dur || 0.5), from: state, to: state, line: ln })
      // pino says the line once the build or route has landed.
      var landed = at + (ln.state ? ln.dur || 1.5 : 0)
      t = at + (ln.dur || (ln.state ? 1.5 : 0.5)) + (ln.wait == null ? 0.35 : ln.wait)
      return landed
    }
    story.steps.forEach(function (st) {
      var T = { start: t }
      t += 0.25
      T.before = (st.before || []).map(said)
      T.type0 = t + 0.25
      T.type1 = T.type0 + clamp(st.you.length / 42, 0.7, 2.8)
      t = T.type1 + 0.55
      T.note = st.note ? t : null
      if (st.note) t += 0.4
      T.lines = (st.lines || []).map(said)
      T.end = t + (st.hold || 2.4)
      st.T = T
      t = T.end
    })
    var total = t, HOLD = 3.5, LOOP = total + HOLD

    // The figure.
    root.classList.add('story')
    var view = html('div', 'story-view', root)
    var head = html('div', 'story-head', view)
    var name = html('span', 'story-name num', head, story.name)
    var rev = html('span', 'story-rev num', head, '')
    var status = html('span', 'story-status', head)
    html('span', 'story-dot', status)
    var statusText = html('span', '', status, '')
    var pause = html('button', 'story-pause', head, 'Pause')
    pause.type = 'button'
    if (still) pause.hidden = true
    void name
    var model = drawing(view, data)
    var readout = html('p', 'story-readout', view, '')
    var chat = html('div', 'story-chat', root)
    var log = html('div', 'story-log', chat)
    var ticks = html('div', 'story-ticks', root)
    var tickFills = story.steps.map(function (st, i) {
      var b = html('button', 'story-tick', ticks)
      b.type = 'button'
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + st.you)
      b.addEventListener('click', function () { clock = st.T.start - 0.01; playing = true; pause.textContent = 'Pause'; kick() })
      return html('span', '', b)
    })
    if (story.summary) html('p', 'story-sr', root, story.summary)

    // The conversation, as events at their times; going back clears it and plays them again at once.
    var events = [], typers = [], ei = 0, lastClock = -1
    events.push({ t: 0, run: function () { html('p', 'story-row story-note', log, story.intro || '') } })
    // pino's lines, in one row for each run of them: what landed, a dot in its verdict's colour.
    var row = null, lines = null
    var line = function (ln, at) {
      events.push({ t: at, run: function () {
        if (!row) {
          row = html('div', 'story-row story-pino', log)
          html('span', 'story-who', row, 'pino')
          lines = html('ul', 'story-lines', row)
        }
        var li = html('li', 'num ' + (ln.kind || ''), lines)
        html('span', 'story-verdict', li)
        li.appendChild(document.createTextNode(ln.say))
      } })
    }
    story.steps.forEach(function (st) {
      var T = st.T
      events.push({ t: T.start, run: function () { row = lines = null } })
      ;(st.before || []).forEach(function (ln, j) { line(ln, T.before[j]) })
      events.push({ t: T.type0 - 0.2, run: function () {
        row = lines = null
        var you = html('div', 'story-row story-you', log)
        html('span', 'story-who', you, 'You')
        var p = html('p', 'story-msg', you)
        var typed = html('span', '', p, '')
        var caret = html('span', 'story-caret', p)
        typers.push({ span: typed, caret: caret, text: st.you, t0: T.type0, t1: T.type1, done: false })
      } })
      if (st.note) events.push({ t: T.note, run: function () { html('p', 'story-row story-note', log, st.note) } })
      ;(st.lines || []).forEach(function (ln, j) { line(ln, T.lines[j]) })
    })
    events.sort(function (a, b) { return a.t - b.t })

    function syncChat(c) {
      if (c < lastClock) {
        log.textContent = ''
        typers = []; ei = 0
        log.classList.add('instant')
        requestAnimationFrame(function () { requestAnimationFrame(function () { log.classList.remove('instant') }) })
      }
      lastClock = c
      while (ei < events.length && events[ei].t <= c) events[ei++].run()
      for (var i = 0; i < typers.length; i++) {
        var ty = typers[i]
        if (ty.done) continue
        var n = Math.round(ty.text.length * clamp((c - ty.t0) / (ty.t1 - ty.t0), 0, 1))
        ty.span.textContent = ty.text.slice(0, n)
        if (n >= ty.text.length) { ty.done = true; ty.caret.remove() }
      }
    }

    // The board at a time: the last state landed, or one landing (`p` 0 to 1), and the line that brought it.
    function stateAt(c) {
      var at = { from: moments.length ? moments[0].from : state, to: null, p: 1, moment: null, done: null }
      for (var i = 0; i < moments.length; i++) {
        var m = moments[i]
        if (c < m.t0) break
        at.moment = m
        if (c < m.t1) { at.from = m.from; at.to = m.to; at.p = (c - m.t0) / (m.t1 - m.t0); return at }
        at.from = m.to; at.done = m
      }
      at.to = at.from
      return at
    }
    var step = function (c) {
      for (var i = story.steps.length - 1; i >= 0; i--) if (c >= story.steps[i].T.start) return i
      return 0
    }


    var lastHead = '', lastRead = ''
    function render(c) {
      syncChat(c)
      var at = stateAt(c)
      model.draw(at.from, at.to, at.p)
      var fade = clamp(c / 0.5, 0, 1) * clamp((LOOP - c) / 0.6, 0, 1)
      model.root.style.opacity = fade.toFixed(3)
      log.style.opacity = (clamp((LOOP - c) / 0.6, 0, 1)).toFixed(3)

      // The head: the newest build and what is going on. A line that lands nothing (a build that failed) is said at
      // once; one that moves the board says what pino is doing until it lands.
      var st = story.steps[step(c)], T = st.T, m = at.moment, done = at.done, text, mode
      var landing = m && at.p < 1 && m.line.state
      if (landing) { mode = 'working'; text = m.line.busy || 'building' }
      else if (st.note && c >= T.note) { mode = ''; text = st.head || 'no build' }
      else if (c >= T.type1 && (!m || m.t0 < T.type1)) { mode = 'working'; text = 'Claude Code is working' }
      else if (done) { mode = done.line.kind || ''; text = done.line.head || done.line.say }
      else { mode = ''; text = 'new project' }
      var shown = done && done.line.rev
      var key = mode + text + shown
      if (key !== lastHead) {
        lastHead = key
        status.className = 'story-status ' + mode
        statusText.textContent = text
        rev.textContent = shown || 'no build'
      }
      var read = model.says(at.p < 1 ? at.from : at.to)
      if (read !== lastRead) { readout.innerHTML = read; lastRead = read }
      story.steps.forEach(function (stp, i) {
        tickFills[i].style.width = (clamp((c - stp.T.start) / (stp.T.end - stp.T.start), 0, 1) * 100).toFixed(1) + '%'
      })
    }

    var clock = 0, last = null, inView = true, playing = true, running = false
    // `?t=12.5` holds the story still at that second, to look at one moment of it while writing one.
    var seek = /[?&]t=([\d.]+)/.exec(location.search)
    if (seek && !still) { clock = Math.min(+seek[1], LOOP - 0.7); playing = false; pause.textContent = 'Play' }
    root.storySeek = function (t) { clock = t; lastClock = Infinity; playing = false; pause.textContent = 'Play'; kick() }
    root.storyTimes = story.steps.map(function (st) { return st.T })
    // Recording, for a look at the story a frame at a time: the page stops its own clock and is stepped, the CSS
    // animations of the conversation stepped with it.
    var recording = false
    root.storyRecord = function () {
      recording = true; playing = false; clock = 0; lastClock = Infinity
      root.classList.add('recording')
      render(0, 0)
      return LOOP
    }
    root.storyAdvance = function (dt) {
      clock += dt
      render(clock, dt)
      document.getAnimations().forEach(function (a) {
        if (a.storyT0 == null) a.storyT0 = clock
        a.pause()
        a.currentTime = (clock - a.storyT0) * 1000
      })
    }
    if (still) {
      clock = total
      render(clock, 0)
      return
    }
    pause.addEventListener('click', function () {
      playing = !playing
      pause.textContent = playing ? 'Pause' : 'Play'
      if (playing) kick()
    })
    new IntersectionObserver(function (es) { inView = es[0].isIntersecting; if (inView) kick() }, { threshold: 0.15 }).observe(root)
    document.addEventListener('visibilitychange', kick)
    function kick() { if (!running) { running = true; last = null; requestAnimationFrame(frame) } }
    function frame(now) {
      var dt = last == null ? 0 : Math.min((now - last) / 1000, 0.1)
      last = now
      if (recording) { running = false; return }
      var live = playing && inView && !document.hidden
      if (live) {
        clock += dt
        if (clock >= LOOP) clock = 0
      }
      render(clock, live ? dt : 0)
      if (live) requestAnimationFrame(frame)
      else running = false
    }
    render(0, 0)
    kick()
  }

  // A story file registers itself by name, and its board's data by the board's; each <figure data-story="name"> on the
  // page plays it.
  var registry = {}, boards = {}
  function register(name, story) { registry[name] = story }
  function board(name, data) { boards[name] = data }
  function start() {
    document.querySelectorAll('[data-story]').forEach(function (el) {
      var story = registry[el.getAttribute('data-story')]
      if (story && !el.storyTimes) play(el, story)
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else setTimeout(start)

  window.PinoStory = { add: register, board: board, play: play }
})()
