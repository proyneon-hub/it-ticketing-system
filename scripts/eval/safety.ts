// The two things about running an evaluation that must not go wrong: it must never write to a real
// database, and it must never expose a secret.

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

// Whether a MongoDB address points at this machine. Only the host is looked at, and it must be exactly
// a local one: "127.0.0.1.evil.example" and "localhost@evil.example" are not.
export function isLocalUri(uri: string): boolean {
  const match = /^mongodb:\/\/(?:[^/@]*@)?(\[[^\]]+\]|[^/:?]+)(?::\d+)?(?:[/?]|$)/.exec(uri);
  if (!match) return false;
  const host = (match[1] as string).replace(/^\[|\]$/g, '');
  return LOCAL_HOSTS.includes(host);
}

// The evaluation creates and deletes tickets by the hundred. It only ever does that to a database it
// started itself, and checks both the address it was given and the host it actually connected to.
export function assertLocalDatabase(uri: string, connectedHost: string | undefined): void {
  if (!isLocalUri(uri) || !connectedHost || !LOCAL_HOSTS.includes(connectedHost)) {
    throw new Error('Refusing to run: the evaluation database is not local.');
  }
}

// The one secret the evaluation needs, from the text of a .env file. Only that line is read: the rest
// of the file holds the production database address and is never loaded.
export function keyFromEnvFile(text: string): string | undefined {
  const value = /^ANTHROPIC_API_KEY=(.*)$/m.exec(text.replace(/\r\n?/g, '\n'))?.[1];
  const cleaned = value
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return cleaned ? cleaned : undefined;
}
