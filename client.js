// Client half of the Attention Notifier bundle.
//
// It polls the pending-session report and selects that session in the UI. The
// Desktop renderer carries HTTP over the shared `/api` transport, so the report
// is requested through that transport: `__DSH_TRANSPORT__.fetch` when the shell
// provides it, the page's own fetch in a browser, and the generic RPC channel as
// a last resort. It also handles a transient `?session=` on page load (the
// fallback when no Harness window was available to focus).
window.__ModuleLoader__.load({
  id: '@local/attention-notifier',
  factory() {
    const POLL_MS = 800
    const PENDING_PATH = 'api/attention-notifier/pending'
    const SESSION_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/

    function openSession(ctx, sessionId) {
      try {
        ctx.uiWorkspace.openSession(sessionId)
      } catch (error) {
        console.error('[attention-notifier] failed to open session', sessionId, error)
      }
    }

    async function readPending(ctx, signal) {
      const transport = globalThis.__DSH_TRANSPORT__
      if (transport && typeof transport.fetch === 'function') {
        try {
          const response = await transport.fetch(PENDING_PATH, {
            method: 'GET',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal,
          })
          if (response && response.ok === true) return await response.json()
        } catch (error) {
          console.warn('[attention-notifier] transport poll failed', error)
        }
      } else if (typeof location !== 'undefined' && location.protocol !== 'file:') {
        try {
          const response = await fetch(PENDING_PATH, {
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
      }
      try {
        const result = await ctx.connection.rpc.call('/attention-notifier', 'pending', null, signal)
        return result && result.ok === true ? result.value : null
      } catch (error) {
        console.warn('[attention-notifier] rpc poll failed', error)
        return null
      }
    }

    return {
      inject: ['connection', 'uiWorkspace'],
      apply(ctx) {
        let lastAt = 0
        let disposed = false
        let inFlight = false

        // The fallback URL carries ?session=. Retry because the startup
        // selection may commit after this plugin mounts.
        let initial = ''
        try {
          initial = new URLSearchParams(location.search).get('session') || ''
        } catch {}
        if (SESSION_PATTERN.test(initial)) {
          for (const delay of [700, 1600, 3200]) {
            setTimeout(() => {
              if (!disposed) openSession(ctx, initial)
            }, delay)
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
            if (typeof value.sessionId === 'string' && SESSION_PATTERN.test(value.sessionId)) openSession(ctx, value.sessionId)
          } catch (error) {
            console.warn('[attention-notifier] poll failed', error)
          } finally {
            clearTimeout(timer)
            inFlight = false
          }
        }

        ctx.effect(() => {
          const interval = setInterval(() => {
            void tick()
          }, POLL_MS)
          void tick()
          return () => {
            disposed = true
            clearInterval(interval)
          }
        }, 'attention-notifier: session focus polling')
      },
    }
  },
})
