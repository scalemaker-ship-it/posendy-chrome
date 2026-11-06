# posendy-chrome-shared

Internal shared types, constants, and message contracts used by the [posendy-chrome](https://github.com/cw02326/posendy-chrome) Chrome extension and the [`posendy-chrome-bridge`](https://www.npmjs.com/package/posendy-chrome-bridge) Node.js Native Messaging host.

**Not intended for direct end-user consumption.** Public APIs are not guaranteed stable across minor versions — pin a specific version if you depend on it.

## Install

```bash
npm install posendy-chrome-shared
```

## Usage

```ts
import { TOOL_NAMES, NativeMessageType } from 'posendy-chrome-shared';
```

Subpath exports: `constants`, `types`, `tools`, `rr-graph`, `step-types`, `labels`, `node-spec`, `node-spec-registry`, `node-specs-builtin`, `agent-types`.

## Links

- Source & issues: <https://github.com/cw02326/posendy-chrome>
- Bridge package: <https://www.npmjs.com/package/posendy-chrome-bridge>

## License

MIT
