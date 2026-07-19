export interface RuntimeWebSession {
  readonly token: string;
  readonly serverOrigin: string;
}

export interface RuntimeWebServer {
  readonly origin: string;
  close(): Promise<void>;
}

export declare const studioSessionBootstrapScript: (session: RuntimeWebSession) => string;

export declare const startRuntimeWebServer: (input: {
  readonly webRoot: string;
  readonly session: RuntimeWebSession;
  readonly host?: string;
  readonly port?: number;
}) => Promise<RuntimeWebServer>;
