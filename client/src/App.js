import { useContext } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { LineraContext } from "./context/LineraContext";
import Home from "./pages/Home";
import Room from "./pages/Room";
import Result from "./pages/Result";
import "./App.css";

const WalletBanner = () => {
  const { ready, initError, initStage, chainId, syncUnlocked, syncHeight } =
    useContext(LineraContext);
  const location = useLocation();

  if (location.pathname !== "/") {
    return null;
  }

  return (
    <div className="wallet_banner">
      {!ready ? (
        <div className="wallet_banner_line">
          {initError ? `Error: ${initError}` : initStage || "Initializing wallet..."}
        </div>
      ) : (
        <>
          <div className="wallet_banner_line">Microchain: {chainId}</div>
          {!syncUnlocked && <div className="wallet_banner_line">Syncing...</div>}
          {syncHeight != null && (
            <div className="wallet_banner_line">Height: {syncHeight}</div>
          )}
        </>
      )}
    </div>
  );
};

const App = () => {
  return (
    <main className="main">
      <div className="container">
        <WalletBanner />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:id" element={<Room />} />
          <Route path="/result" element={<Result />} />
        </Routes>
      </div>
    </main>
  );
};

export default App;
