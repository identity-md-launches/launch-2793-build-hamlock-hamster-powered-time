# Verification fixture

`hamlock-runtime.hex` is the actual Sepolia bytecode read at the verified HAMLOCK address on 2026-10-31. It exactly matched Solidity 0.8.28 output using this repository's optimizer/EVM/metadata settings, with the verified immutable SqueekCore address inserted at the compiler's immutable-reference locations.

Its Keccak hash is recorded in `web/deployment.json` and asserted by the browser validation harness. It lets the offline RPC mock exercise the same deployment guard as the real site. It is test input, is outside `public/`, and is not part of the production export.

All mock wallet addresses are generated at test runtime. No private keys, real wallet account, stand-in deployment or fixture ranking is included in the website.
