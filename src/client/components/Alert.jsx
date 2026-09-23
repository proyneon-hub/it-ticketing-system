// The message sits in its own element so it can be read (and asserted on) without
// the support reference that follows it.
export default function Alert({ type, message, requestId }) {
  if (!message) return null;

  return (
    <div className={`alert ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {requestId ? <small className="alert-reference"> Reference: {requestId}</small> : null}
    </div>
  );
}
