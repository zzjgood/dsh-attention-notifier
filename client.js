// Client half of the Attention Notifier bundle.
//
// It polls the pending-session report and selects that session in the UI. The
// page carries the request itself: in the Desktop renderer a relative fetch is
// answered by the `dsh-app://` protocol forwarder, and in a browser by the Host
// origin. A `file://` page, or a failed request, falls back to the generic RPC
// channel. It also reports the UI language on every poll so the Host can write
// the desktop card in it, and handles a transient `?session=` on page load (the
// fallback when no Harness window was available to focus).
window.__ModuleLoader__.load({
  id: '@local/attention-notifier',
  factory() {
    const POLL_MS = 800
    const PENDING_PATH = 'api/attention-notifier/pending'
    const SESSION_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/

    function activeLanguage(ctx) {
      try {
        const snapshot = ctx.get('locale')?.getSnapshot?.()
        const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
        if (active.toLowerCase().startsWith('zh')) return 'zh'
        if (active) return 'en'
      } catch {}
      return ''
    }

    function openSession(ctx, sessionId) {
      try {
        ctx.uiWorkspace.openSession(sessionId)
      } catch (error) {
        console.error('[attention-notifier] failed to open session', sessionId, error)
      }
    }

    async function readPendingRpc(ctx, signal) {
      try {
        const result = await ctx.connection.rpc.call('/attention-notifier', 'pending', { lang: activeLanguage(ctx) }, signal)
        return result && result.ok === true ? result.value : null
      } catch (error) {
        console.warn('[attention-notifier] rpc poll failed', error)
        return null
      }
    }

    async function readPending(ctx, signal) {
      if (typeof location === 'undefined' || location.protocol === 'file:') return readPendingRpc(ctx, signal)
      try {
        const lang = activeLanguage(ctx)
        const response = await fetch(lang === '' ? PENDING_PATH : PENDING_PATH + '?lang=' + lang, {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        })
        if (response.ok) return await response.json()
      } catch (error) {
        console.warn('[attention-notifier] http poll failed', error)
      }
      return readPendingRpc(ctx, signal)
    }

    return {
      inject: ['connection', 'uiWorkspace'],
      apply(ctx) {
        let lastAt = 0
        let disposed = false
        let inFlight = false
        let retryTimers = []
        let retriesActive = false

        const cancelRetries = () => {
          retriesActive = false
          for (const timer of retryTimers) clearTimeout(timer)
          retryTimers = []
        }

        // The fallback URL carries `?session=`. Retry because the startup selection
        // may commit after this plugin mounts, but stop as soon as the user
        // navigates on their own or a newer card report is consumed.
        const initial = (() => {
          try {
            return new URLSearchParams(location.search).get('session') || ''
          } catch {
            return ''
          }
        })()
        if (SESSION_PATTERN.test(initial)) {
          retriesActive = true
          for (const delay of [700, 1600, 3200]) {
            retryTimers.push(setTimeout(() => {
              if (!disposed && retriesActive) openSession(ctx, initial)
            }, delay))
          }
        }

        const tick = async () => {
          if (disposed || inFlight) return
          inFlight = true
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 3000)
          try {
            const value = await readPending(ctx, controller.signal)
            if (disposed || !value || typeof value.at !== 'number' || value.at <= lastAt) return
            lastAt = value.at
            if (typeof value.sessionId !== 'string' || !SESSION_PATTERN.test(value.sessionId)) return
            cancelRetries()
            openSession(ctx, value.sessionId)
          } catch (error) {
            console.warn('[attention-notifier] poll failed', error)
          } finally {
            clearTimeout(timer)
            inFlight = false
          }
        }

        ctx.effect(() => {
          let interval = 0
          const interactionEvents = ['pointerdown', 'keydown', 'wheel']
          const onInteraction = () => cancelRetries()
          const start = () => {
            if (disposed || interval !== 0) return
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            void tick()
            interval = setInterval(() => {
              void tick()
            }, POLL_MS)
          }
          const stop = () => {
            if (interval !== 0) {
              clearInterval(interval)
              interval = 0
            }
          }
          const onVisibility = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') start()
            else stop()
          }
          if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility)
            for (const name of interactionEvents) document.addEventListener(name, onInteraction, { once: true, capture: true, passive: true })
          }
          start()
          return () => {
            disposed = true
            stop()
            cancelRetries()
            if (typeof document !== 'undefined') {
              document.removeEventListener('visibilitychange', onVisibility)
              for (const name of interactionEvents) document.removeEventListener(name, onInteraction, { capture: true })
            }
          }
        }, 'attention-notifier: session focus polling')
      },
    }
  },
})
