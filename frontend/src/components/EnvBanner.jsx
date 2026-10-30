import { BACKEND_ENV, frontendEnv, sendModeText } from '../envInfo'

// Colored by the backend's environment — that's where data is read/written
// and email is sent from.
const ENV_STYLES = {
  LOCAL: 'bg-green-600',
  DEV: 'bg-blue-600',
  PRODUCTION: 'bg-red-600',
}

export default function EnvBanner({ pageSendMode }) {
  const frontend = frontendEnv()
  const backend = BACKEND_ENV
  return (
    <div className={`${ENV_STYLES[backend]} text-white text-xs px-4 py-1 flex items-center gap-x-4 gap-y-1 flex-wrap`}>
      <span className="whitespace-pre">
        <span className="font-bold tracking-wide">{backend}</span>
        {'  ·  '}Frontend: {frontend}{'  ·  '}Backend: {backend}
      </span>
      {frontend !== backend && (
        <span className="bg-yellow-300 text-yellow-900 font-semibold rounded px-2 py-0.5">
          Warning: Frontend is {frontend} but backend is {backend}
        </span>
      )}
      {pageSendMode && (
        <span className="font-semibold ml-auto">
          {sendModeText(pageSendMode.sendMode, pageSendMode.sendModeError)}
        </span>
      )}
    </div>
  )
}
