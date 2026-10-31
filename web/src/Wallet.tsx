import { useState } from "react";
import {
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { getAddress } from "viem";
import { Modal } from "./Modal";
import { errorMessage, short } from "./logic";
import { sepolia, EXPLORER } from "./chain";
import { OPEN_IN, isMobileBrowser } from "./open-in";

export function Wallet({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const { mutateAsync: connect, isPending, variables } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain();
  const [message, setMessage] = useState("");
  const mobile = isMobileBrowser();
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter(
    (c) =>
      !(c.id === "injected" && named) && (!mobile || c.type !== "injected"),
  );
  async function choose(connector: Connector) {
    setMessage("");
    try {
      if (connector.id === "injected" && !(await connector.getProvider())) {
        setMessage(
          "No browser wallet found. Install MetaMask or Rabby, or choose Coinbase Wallet below.",
        );
        return;
      }
      await connect({ connector });
      setOpen(false);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  async function switchToSepolia() {
    setMessage("");
    try {
      await switchChain({ chainId: sepolia.id });
      setOpen(false);
    } catch (error) {
      setMessage(errorMessage(error));
      setOpen(true);
    }
  }
  const wrongChain = isConnected && chainId !== sepolia.id;
  return (
    <>
      <button
        className="wallet-control"
        type="button"
        onClick={wrongChain ? switchToSepolia : () => setOpen(true)}
        disabled={switching}
      >
        <span className="wallet-symbol" aria-hidden="true">
          ▣
        </span>
        {switching
          ? "Switching…"
          : wrongChain
            ? "Switch to Sepolia"
            : address
              ? short(getAddress(address))
              : "Connect wallet"}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isConnected ? "Your wallet" : "Connect a wallet"}
        className="wallet-modal"
      >
        {isConnected && address ? (
          <>
            <p className="muted">
              Connected to{" "}
              {chainId === sepolia.id ? "Ethereum Sepolia" : "another network"}.
            </p>
            <a
              className="full-address"
              href={`${EXPLORER}/address/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              {getAddress(address)} ↗
            </a>
            {wrongChain && (
              <button
                className="primary full"
                type="button"
                disabled={switching}
                onClick={switchToSepolia}
              >
                {switching ? "Switching…" : "Switch to Sepolia"}
              </button>
            )}
            <button
              className="secondary full"
              type="button"
              onClick={() => {
                disconnect();
                setMessage("");
                setOpen(false);
              }}
            >
              Disconnect wallet
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Your wallet holds the keys. HAMLOCK only uses Sepolia test ETH.
            </p>
            <div className="wallet-list">
              {mobile &&
                OPEN_IN.map((wallet) => (
                  <a
                    className="wallet-row"
                    key={wallet.id}
                    href={wallet.href(location.href)}
                  >
                    <img
                      src={`./wallets/${wallet.id}.svg`}
                      width="28"
                      height="28"
                      alt=""
                    />
                    <span>Open in {wallet.name}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              {listed.map((connector) => (
                <button
                  className="wallet-row"
                  type="button"
                  key={connector.uid}
                  onClick={() => choose(connector)}
                  disabled={isPending}
                >
                  <img
                    src={
                      connector.icon ??
                      `./wallets/${connector.id === "coinbaseWalletSDK" ? "coinbase" : "browser"}.svg`
                    }
                    width="28"
                    height="28"
                    alt=""
                  />
                  <span>
                    {connector.id === "injected"
                      ? "Browser wallet"
                      : connector.id === "coinbaseWalletSDK"
                        ? mobile
                          ? "Coinbase Smart Wallet"
                          : "Coinbase Wallet"
                        : connector.name}
                    {isPending && variables?.connector === connector
                      ? " · opening…"
                      : ""}
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            {mobile && (
              <p className="small muted">
                Open this page in your wallet’s browser to connect without a
                relay.
              </p>
            )}
          </>
        )}
        <p className="form-message" role="status">
          {message}
        </p>
      </Modal>
    </>
  );
}
