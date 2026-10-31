import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { createPublicClient, fallback, keccak256 } from "viem";
import { sepolia as baseSepolia } from "viem/chains";
import { hamlockAbi } from "./abi";
import deployment from "../deployment.json";

export { hamlockAbi };
// Verified deployment, source commit and RPCs from the pinned launch inputs.
export const HAMLOCK = "0xc17b08994b70b468aa30e4e3d73edf9d65727302" as const;
export const DEPLOYMENT_BLOCK = 12036187n;
export const SOURCE =
  "https://github.com/identity-md-launches/launch-2793-build-hamlock-hamster-powered-time/blob/9681bafe1674f448285c0599a2dbec90e95da4eb/src/Hamlock.sol";
export const EXPLORER = "https://sepolia.etherscan.io";
export const STATUS_URL = "https://api.squeekchain.com/v1/status";
export const RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.ethpandaops.io",
  "https://sepolia.rpc.sentio.xyz",
] as const;
export const sepolia = {
  ...baseSepolia,
  rpcUrls: { default: { http: RPC_URLS } },
} as const;
export const transport = () =>
  fallback(
    RPC_URLS.map((url) => http(url, { timeout: 9_000, retryCount: 0 })),
    { retryCount: 1 },
  );
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: transport(),
  batch: { multicall: true },
});
export const config = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: "HAMLOCK" })],
  transports: { [sepolia.id]: transport() },
});

export async function verifyDeployment() {
  const [chainId, bytecode] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: HAMLOCK }),
  ]);
  if (
    chainId !== sepolia.id ||
    !bytecode ||
    bytecode === "0x" ||
    keccak256(bytecode) !== deployment.runtimeCodeHash
  ) {
    throw new Error(
      "The Sepolia contract could not be verified. Retry before sending a transaction.",
    );
  }
  return true;
}
