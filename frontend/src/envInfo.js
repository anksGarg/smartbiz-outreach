import { createContext, useContext, useEffect } from 'react'
import { API_URL } from './config'

// LOCAL / DEV / PRODUCTION from a hostname. Anything unrecognized counts as
// PRODUCTION, so an unknown setup is shown as the riskiest one.
export function classifyHost(hostname) {
  const host = (hostname || '').toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1') return 'LOCAL'
  if (host.includes('dev')) return 'DEV'
  return 'PRODUCTION'
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export const BACKEND_ENV = classifyHost(hostnameOf(API_URL))

export function frontendEnv() {
  return classifyHost(window.location.hostname)
}

// Same wording everywhere the send mode is shown (banner and send bar).
export function sendModeText(sendMode, sendModeError) {
  if (sendMode) {
    return sendMode.mode === 'test'
      ? `TEST: all emails go to ${sendMode.test_recipient || '(test address not set)'}`
      : 'LIVE: emails go to real customers'
  }
  return sendModeError ? 'Send mode unknown' : 'Checking send mode…'
}

export function sendConfirmText(count, sendMode) {
  const what = `Send ${count} email${count !== 1 ? 's' : ''}?`
  return sendMode?.mode === 'test'
    ? `${what} TEST mode: all will be sent to ${sendMode.test_recipient}, not to the customers.`
    : `${what} LIVE mode: these go to real customers.`
}

// Lets an email page show the send mode it already fetched from
// /followup/send-mode in the layout banner (see App.jsx) — no extra request.
export const SendModeContext = createContext(() => {})

export function useBannerSendMode(sendMode, sendModeError) {
  const report = useContext(SendModeContext)
  useEffect(() => {
    report({ sendMode, sendModeError })
    return () => report(null)
  }, [report, sendMode, sendModeError])
}
