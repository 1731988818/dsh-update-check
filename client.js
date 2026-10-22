/**
 * dsh-update-check — Client half.
 *
 * Reads the Host snapshot from the same-origin route and, when anything is
 * behind, shows a small dismissible card in the frame-wide overlay. Profile
 * plugins get an inline install button that posts back to the Host route; the
 * Harness build and the rea-agents CLI are shown as manual, because neither can
 * be replaced from inside the running profile.
 */
window.__ModuleLoader__.load({
  id: 'dsh-update-check',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useState } = React

    const ROUTE = '/dsh-update-check/api/status'
    const INSTALL_ROUTE = '/dsh-update-check/api/install'

    const mutedColor = 'var(--dsw-alias-label-secondary, #6b7280)'
    const successColor = 'var(--dsw-alias-state-success-primary, #16a34a)'
    const errorColor = 'var(--dsw-alias-state-error-primary, #dc2626)'
    const warnColor = 'var(--dsw-alias-state-warn-primary, #d97706)'

    const cardStyle = {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 2147483000,
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      width: '352px',
      maxWidth: 'calc(100vw - 32px)',
      padding: '12px 14px',
      boxSizing: 'border-box',
      borderRadius: '12px',
      background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
      boxShadow: '0 10px 30px rgba(0,0,0,.18)',
      color: 'var(--dsw-alias-label-primary, #111827)',
      font: '13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      pointerEvents: 'auto',
    }

    const headerStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    }

    const titleStyle = {
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary, #111827)',
    }

    const iconButtonStyle = {
      appearance: 'none',
      border: 'none',
      background: 'transparent',
      color: mutedColor,
      cursor: 'pointer',
      padding: '0 2px',
      fontSize: '16px',
      lineHeight: '1',
      borderRadius: '4px',
    }

    const linkButtonStyle = {
      appearance: 'none',
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-brand-primary, #247bbf)',
      cursor: 'pointer',
      padding: 0,
      fontSize: '12px',
      textAlign: 'left',
    }

    const footerStyle = {
      marginTop: '2px',
      paddingTop: '6px',
      borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      fontSize: '11px',
      color: mutedColor,
    }

    const monoStyle = {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }

    const installButtonStyle = {
      appearance: 'none',
      border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
      background: 'var(--dsw-alias-bg-layer-1, #f9fafb)',
      color: 'var(--dsw-alias-label-primary, #111827)',
      cursor: 'pointer',
      borderRadius: '6px',
      padding: '0 8px',
      fontSize: '11px',
      lineHeight: '18px',
      flex: '0 0 auto',
      whiteSpace: 'nowrap',
    }

    const busyButtonStyle = {
      ...installButtonStyle,
      opacity: 0.6,
      cursor: 'default',
    }

    function describeOutcome(outcome) {
      if (!outcome || outcome.ok !== false) return null
      const code = outcome.error && outcome.error.code ? outcome.error.code : 'failed'
      const diagnostic = outcome.error && outcome.error.diagnostic ? `: ${outcome.error.diagnostic}` : ''
      return `${code}${diagnostic}`
    }

    function Row({ item, busy, outcome, disabled, onInstall }) {
      let action

      if (item.kind === 'plugin' && item.installable !== false) {
        if (busy) {
          action = h('button', { type: 'button', style: busyButtonStyle, disabled: true }, '安装中…')
        } else if (outcome && outcome.ok) {
          const restart = outcome.application === 'restart-required'
          action = h(
            'span',
            {
              title: restart ? '已安装，重启 Harness 后生效' : '已安装',
              style: { fontSize: '11px', color: successColor, flex: '0 0 auto', whiteSpace: 'nowrap' },
            },
            restart ? '✓ 待重启' : '✓ 已更新',
          )
        } else if (outcome && outcome.ok === false) {
          action = h(
            'button',
            {
              type: 'button',
              title: describeOutcome(outcome) || '安装失败',
              style: { ...installButtonStyle, color: errorColor },
              disabled: disabled,
              onClick: () => onInstall(item),
            },
            '重试',
          )
        } else {
          action = h(
            'button',
            {
              type: 'button',
              title: `安装 ${item.latest}`,
              style: disabled ? busyButtonStyle : installButtonStyle,
              disabled: disabled,
              onClick: () => onInstall(item),
            },
            '更新',
          )
        }
      } else if (item.kind === 'dsh') {
        action = h(
          'span',
          { title: '需要下载新的安装包并重新安装', style: { fontSize: '11px', color: warnColor, flex: '0 0 auto' } },
          '需手动',
        )
      } else if (item.kind === 'cli') {
        action = h(
          'span',
          { title: '在终端执行：npm i -g rea-agents@latest', style: { fontSize: '11px', color: mutedColor, flex: '0 0 auto' } },
          '需手动',
        )
      } else {
        action = h(
          'span',
          {
            title: '市场不能一键自我更新：完全退出 DSH 后，在 profile 目录执行 pnpm add dshmarket@latest',
            style: { fontSize: '11px', color: warnColor, flex: '0 0 auto' },
          },
          '需手动',
        )
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '2px 0',
          },
        },
        h(
          'span',
          {
            title: item.name,
            style: {
              ...monoStyle,
              fontSize: '12px',
              color: 'var(--dsw-alias-label-primary, #111827)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: '1 1 auto',
            },
          },
          item.name,
        ),
        h(
          'span',
          {
            style: {
              ...monoStyle,
              flex: '0 0 auto',
              fontSize: '11px',
              color: mutedColor,
            },
          },
          `${item.current || '?'} → ${item.latest || '?'}`,
        ),
        action,
      )
    }

    function UpdateNotice() {
      const [data, setData] = useState(null)
      const [attempt, setAttempt] = useState(0)
      const [dismissed, setDismissed] = useState(false)
      const [expanded, setExpanded] = useState(false)
      const [installing, setInstalling] = useState(null)
      const [outcomes, setOutcomes] = useState({})

      useEffect(() => {
        if (dismissed) return undefined

        let cancelled = false
        let timer = null

        const load = async () => {
          try {
            const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (cancelled) return

            setData(body)

            const retryLimit = typeof body.maxRetryPolls === 'number' ? body.maxRetryPolls : 30
            if (!body.done && attempt < retryLimit) {
              const delay = typeof body.pollAfterMs === 'number' ? body.pollAfterMs : 2000
              timer = setTimeout(() => setAttempt((value) => value + 1), delay)
            }
          } catch (error) {
            if (cancelled) return
            setData({
              done: true,
              error: error && error.message ? error.message : String(error),
              dsh: null,
              items: [],
            })
          }
        }

        void load()

        return () => {
          cancelled = true
          if (timer) clearTimeout(timer)
        }
      }, [attempt, dismissed])

      const outdated = useMemo(() => {
        const list = []
        if (!data) return list

        if (data.dsh && data.dsh.status === 'outdated') {
          list.push({ kind: 'dsh', name: 'DeepSeek Harness', current: data.dsh.current, latest: data.dsh.latest })
        }
        for (const item of data.items || []) {
          if (item && item.status === 'outdated') list.push(item)
        }
        return list
      }, [data])

      const install = async (item) => {
        setInstalling(item.name)
        setOutcomes((previous) => {
          const next = { ...previous }
          delete next[item.name]
          return next
        })

        try {
          const response = await fetch(INSTALL_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ name: item.name }),
          })
          const body = await response.json().catch(() => null)
          setOutcomes((previous) => ({
            ...previous,
            [item.name]: body || { ok: false, error: { code: `http-${response.status}` } },
          }))
        } catch (error) {
          setOutcomes((previous) => ({
            ...previous,
            [item.name]: {
              ok: false,
              error: { code: 'network', diagnostic: error && error.message ? error.message : String(error) },
            },
          }))
        } finally {
          setInstalling(null)
          setAttempt((value) => value + 1)
        }
      }

      const installAll = async () => {
        for (const item of outdated) {
          if (item.kind !== 'plugin' || item.installable === false) continue
          await install(item)
        }
      }

      if (dismissed || !data || !data.done || outdated.length === 0) return null

      const visible = expanded ? outdated : outdated.slice(0, 4)
      const remaining = outdated.length - visible.length
      const installableCount = outdated.filter((item) => item.kind === 'plugin' && item.installable !== false).length
      const busyOverall = installing !== null

      return h(
        'div',
        { style: cardStyle, role: 'status' },
        h(
          'div',
          { style: headerStyle },
          h('span', { style: titleStyle }, `发现 ${outdated.length} 项可用更新`),
          h(
            'button',
            {
              type: 'button',
              title: '关闭',
              'aria-label': '关闭更新提示',
              style: iconButtonStyle,
              onClick: () => setDismissed(true),
            },
            '×',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          visible.map((item, index) =>
            h(Row, {
              key: `${item.name}-${index}`,
              item,
              busy: installing === item.name,
              outcome: outcomes[item.name],
              disabled: busyOverall,
              onInstall: install,
            }),
          ),
        ),
        remaining > 0
          ? h(
              'button',
              { type: 'button', style: linkButtonStyle, onClick: () => setExpanded(true) },
              `还有 ${remaining} 项`,
            )
          : null,
        h(
          'div',
          { style: footerStyle },
          h(
            'span',
            null,
            installableCount > 0 ? `可一键更新 ${installableCount} 个插件` : '其余需手动更新',
          ),
          h(
            'span',
            { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            installableCount > 1
              ? h(
                  'button',
                  {
                    type: 'button',
                    title: `更新全部 ${installableCount} 个插件`,
                    style: { ...linkButtonStyle, fontSize: '11px' },
                    disabled: busyOverall,
                    onClick: installAll,
                  },
                  busyOverall ? '更新中…' : '全部更新',
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                title: '重新检查',
                style: { ...linkButtonStyle, fontSize: '11px' },
                disabled: busyOverall,
                onClick: async () => {
                  try {
                    await fetch(`${ROUTE}?refresh=1`, { headers: { accept: 'application/json' } })
                  } catch {
                    // A failed refresh just leaves the previous snapshot on screen.
                  }
                  setAttempt((value) => value + 1)
                },
              },
              '重新检查',
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-update-check', order: 50 }, UpdateNotice),
        )
      },
    }
  },
})
