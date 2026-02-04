import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as linera from "@linera/client";
import { Wallet } from "ethers";

const LineraContext = createContext();

const DEFAULT_FAUCET_URL =
  process.env.REACT_APP_LINERA_FAUCET_URL || "http://localhost:8080";

const DEFAULT_APPLICATION_ID = process.env.REACT_APP_LINERA_APPLICATION_ID || "";

const getCookie = (name) => {
  try {
    const parts = String(document.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);
    const prefix = `${encodeURIComponent(name)}=`;
    const found = parts.find((p) => p.startsWith(prefix));
    if (!found) return "";
    return decodeURIComponent(found.slice(prefix.length));
  } catch {
    return "";
  }
};

const setCookie = (name, value, maxAgeSeconds = 60 * 60 * 24 * 365) => {
  try {
    const encodedName = encodeURIComponent(name);
    const encodedValue = encodeURIComponent(String(value));
    document.cookie = `${encodedName}=${encodedValue}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
  } catch {}
};

const syncHeightCookieName = (chainId) => `linera_sync_height_${String(chainId || "")}`;
const syncHeightStorageKey = (chainId) => `linera_sync_height:${String(chainId || "")}`;

const parseHeightNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const extractNotificationHeight = (notification) => {
  const direct =
    parseHeightNumber(notification?.height) ??
    parseHeightNumber(notification?.blockHeight) ??
    parseHeightNumber(notification?.block_height);
  if (direct != null) return direct;
  const nb = notification?.reason?.NewBlock;
  const newBlock =
    parseHeightNumber(nb) ??
    parseHeightNumber(nb?.height) ??
    parseHeightNumber(nb?.blockHeight) ??
    parseHeightNumber(nb?.block_height);
  if (newBlock != null) return newBlock;
  try {
    const s = JSON.stringify(notification);
    const m =
      s.match(/block_height"?\s*[:=]\s*"?(\d+)"?/i) ||
      s.match(/blockHeight"?\s*[:=]\s*"?(\d+)"?/i) ||
      s.match(/height"?\s*[:=]\s*"?(\d+)"?/i);
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10);
      return Number.isFinite(n) ? n : null;
    }
  } catch {}
  return null;
};

const ensureWasmInstantiateStreamingFallback = () => {
  if (typeof WebAssembly === "undefined") return;
  const wasmAny = WebAssembly;
  const original = wasmAny.instantiateStreaming;
  if (typeof original !== "function") return;
  wasmAny.instantiateStreaming = async (source, importObject) => {
    try {
      const res = source instanceof Response ? source : await source;
      const ct = res.headers?.get("Content-Type") || "";
      if (ct.includes("application/wasm")) {
        return original(Promise.resolve(res), importObject);
      }
      const buf = await res.arrayBuffer();
      return WebAssembly.instantiate(buf, importObject);
    } catch {
      const res = source instanceof Response ? source : await source;
      const buf = await res.arrayBuffer();
      return WebAssembly.instantiate(buf, importObject);
    }
  };
};

const escapeGqlString = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");

const defaultPlayerName = (chainId) => {
  if (!chainId) return "Player";
  return `Player-${String(chainId).slice(0, 6)}`;
};

const LineraContextProvider = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState("");
  const [initStage, setInitStage] = useState("");
  const [chainId, setChainId] = useState("");
  const [applicationId, setApplicationId] = useState(DEFAULT_APPLICATION_ID);
  const [faucetUrl, setFaucetUrl] = useState(DEFAULT_FAUCET_URL);
  const [syncHeight, setSyncHeight] = useState(null);
  const [syncUnlocked, setSyncUnlocked] = useState(true);
  const [finalResult, setFinalResult] = useState(null);

  const [game, setGame] = useState(null);
  const [matchStatus, setMatchStatus] = useState(null);
  const [letters, setLetters] = useState("");
  const [round, setRound] = useState(0);
  const [roundPhase, setRoundPhase] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [opponentChainId, setOpponentChainId] = useState(null);
  const [myWord, setMyWord] = useState(null);
  const [opponentWord, setOpponentWord] = useState(null);
  const [myScore, setMyScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [lastRoundRecord, setLastRoundRecord] = useState(null);
  const [roundHistory, setRoundHistory] = useState([]);
  const [lastNotification, setLastNotification] = useState(null);

  const clientRef = useRef(null);
  const chainRef = useRef(null);
  const appRef = useRef(null);
  const notificationUnsubRef = useRef(null);
  const refreshInFlightRef = useRef(false);
  const syncMinHeightRef = useRef(0);
  const refreshDebounceTimerRef = useRef(null);
  const lastSnapshotRef = useRef({});
  const isMountedRef = useRef(true);
  const initInProgressRef = useRef(false);

  const gql = useCallback(async (query) => {
    if (!appRef.current) throw new Error("Linera app not initialized");
    const res = await appRef.current.query(JSON.stringify({ query }));
    const data = typeof res === "string" ? JSON.parse(res) : res;
    if (data?.errors?.length) {
      const msg = data.errors.map((e) => e.message).join("; ");
      throw new Error(msg);
    }
    return data?.data;
  }, []);

  const refresh = useCallback(async () => {
    if (!ready) return;
    if (!syncUnlocked) {
      setGame(null);
      setMatchStatus(null);
      setLetters("");
      setRound(0);
      setRoundPhase(null);
      setIsHost(false);
      setOpponentChainId(null);
      setMyWord(null);
      setOpponentWord(null);
      setMyScore(0);
      setOpponentScore(0);
      setLastRoundRecord(null);
      setRoundHistory([]);
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const data = await gql(`
        query {
          game {
            matchId
            hostChainId
            status
            players { chainId name }
            letters
            totalRounds
            currentRound
            hostScore
            guestScore
            roundPhase
            hostWord
            guestWord
            winnerChainId
            history { round hostWord guestWord hostPoints guestPoints hostScore guestScore timestamp }
          }
          matchStatus
          letters
          round
          roundPhase
          isHost
          opponentChainId
          myWord
          opponentWord
          myScore
          opponentScore
          lastRoundRecord { round hostWord guestWord hostPoints guestPoints hostScore guestScore timestamp }
          roundHistory { round hostWord guestWord hostPoints guestPoints hostScore guestScore timestamp }
          lastNotification
        }
      `);
      const nextGame = data?.game ?? null;
      const nextGameJson = JSON.stringify(nextGame);
      if (nextGameJson !== lastSnapshotRef.current.gameJson) {
        lastSnapshotRef.current.gameJson = nextGameJson;
        setGame(nextGame);
      }

      setMatchStatus(data?.matchStatus ?? null);
      setLetters(data?.letters ?? nextGame?.letters ?? "");
      setRound(Number(nextGame?.currentRound ?? data?.round ?? 0));
      setRoundPhase(data?.roundPhase ?? nextGame?.roundPhase ?? null);
      setIsHost(Boolean(data?.isHost));
      setOpponentChainId(data?.opponentChainId ?? null);
      setMyWord(data?.myWord ?? null);
      setOpponentWord(data?.opponentWord ?? null);
      setMyScore(Number(data?.myScore ?? 0));
      setOpponentScore(Number(data?.opponentScore ?? 0));

      const statusStr = String(nextGame?.status ?? data?.matchStatus ?? "").toLowerCase();
      if (statusStr === "ended") {
        setFinalResult((prev) => {
          const next = {
            matchId: nextGame?.matchId ?? null,
            myScore: Number(data?.myScore ?? 0),
            opponentScore: Number(data?.opponentScore ?? 0),
            winnerChainId: nextGame?.winnerChainId ?? null,
          };
          const prevJson = prev ? JSON.stringify(prev) : "";
          const nextJson = JSON.stringify(next);
          return prevJson === nextJson ? prev : next;
        });
      }

      const nextLastRoundRecord = data?.lastRoundRecord ?? null;
      const nextLastRoundRecordJson = JSON.stringify(nextLastRoundRecord);
      if (nextLastRoundRecordJson !== lastSnapshotRef.current.lastRoundRecordJson) {
        lastSnapshotRef.current.lastRoundRecordJson = nextLastRoundRecordJson;
        setLastRoundRecord(nextLastRoundRecord);
      }

      const nextRoundHistory = Array.isArray(data?.roundHistory) ? data.roundHistory : [];
      const nextRoundHistoryJson = JSON.stringify(nextRoundHistory);
      if (nextRoundHistoryJson !== lastSnapshotRef.current.roundHistoryJson) {
        lastSnapshotRef.current.roundHistoryJson = nextRoundHistoryJson;
        setRoundHistory(nextRoundHistory);
      }

      setLastNotification(data?.lastNotification ?? null);
    } catch (e) {
      setLastNotification(String(e?.message || e));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [gql, ready, syncUnlocked]);

  const scheduleRefresh = useCallback(() => {
    if (refreshDebounceTimerRef.current) return;
    refreshDebounceTimerRef.current = setTimeout(() => {
      refreshDebounceTimerRef.current = null;
      refresh();
    }, 150);
  }, [refresh]);

  const startNotifications = useCallback(() => {
    if (!isMountedRef.current) return;
    if (!chainRef.current || typeof chainRef.current.onNotification !== "function") return;
    if (typeof notificationUnsubRef.current === "function") {
      try {
        notificationUnsubRef.current();
      } catch {}
      notificationUnsubRef.current = null;
    }
    const handler = (notification) => {
      if (!isMountedRef.current) return;
      if (!chainRef.current) return;
      try {
        const height = extractNotificationHeight(notification);
        if (height != null && chainId) {
          const nextStoredHeight = Math.max(syncMinHeightRef.current || 0, height);
          syncMinHeightRef.current = nextStoredHeight;
          if (isMountedRef.current) {
            setSyncHeight((prev) => (prev === nextStoredHeight ? prev : nextStoredHeight));
          }
          setCookie(syncHeightCookieName(chainId), nextStoredHeight);
          try {
            localStorage.setItem(syncHeightStorageKey(chainId), String(nextStoredHeight));
          } catch {}
          if (height >= (syncMinHeightRef.current || 0) && isMountedRef.current) {
            setSyncUnlocked(true);
          }
        }
        if (notification?.reason?.NewBlock && syncUnlocked && isMountedRef.current) {
          scheduleRefresh();
        } else if (notification?.reason?.NewBlock && !syncUnlocked && isMountedRef.current) {
          const heightNow = extractNotificationHeight(notification);
          if (heightNow != null && heightNow >= (syncMinHeightRef.current || 0)) {
            setSyncUnlocked(true);
            scheduleRefresh();
          }
        }
      } catch {}
    };
    const maybeUnsub = chainRef.current.onNotification(handler);
    if (typeof maybeUnsub === "function") {
      notificationUnsubRef.current = maybeUnsub;
    }
  }, [chainId, scheduleRefresh, syncUnlocked]);

  const initLinera = useCallback(async () => {
    if (initInProgressRef.current) return;
    initInProgressRef.current = true;
    try {
      setInitError("");
      setInitStage("Initializing wallet...");
      setReady(false);
      setSyncHeight(null);
      setSyncUnlocked(true);
      setGame(null);
      setLastNotification(null);

      if (!applicationId) {
        setInitError("Missing REACT_APP_LINERA_APPLICATION_ID");
        setInitStage("Configuration error");
        return;
      }

      ensureWasmInstantiateStreamingFallback();
      setInitStage("Initializing Linera...");
      try {
        await linera.initialize();
      } catch (e) {
        console.warn("Linera initialization warning:", e);
      }

      setInitStage("Preparing mnemonic...");
      let mnemonic = "";
      try {
        mnemonic = localStorage.getItem("linera_mnemonic") || "";
      } catch {}
      if (!mnemonic) {
        const generated = Wallet.createRandom();
        const phrase = generated.mnemonic?.phrase;
        if (!phrase) {
          setInitError("Failed to generate mnemonic");
          setInitStage("Mnemonic generation failed");
          return;
        }
        mnemonic = phrase;
        try {
          localStorage.setItem("linera_mnemonic", mnemonic);
        } catch {}
      }

      try {
        setInitStage("Creating wallet...");
        const signer = linera.signer.PrivateKey.fromMnemonic(mnemonic);
        const faucet = new linera.Faucet(faucetUrl);
        const owner = signer.address();

        const wallet = await faucet.createWallet();
        setInitStage("Creating microchain...");
        const newChainId = await faucet.claimChain(wallet, owner);

        setInitStage("Connecting to application...");
        const clientInstance = await new linera.Client(wallet, signer, {
          skipProcessInbox: false,
        });
        const chain = await clientInstance.chain(newChainId);
        const application = await chain.application(applicationId);

        clientRef.current = clientInstance;
        chainRef.current = chain;
        appRef.current = application;
        let minHeight = 0;
        try {
          const cookieValue = getCookie(syncHeightCookieName(newChainId));
          const localValue = localStorage.getItem(syncHeightStorageKey(newChainId)) || "";
          minHeight = parseHeightNumber(localValue) ?? parseHeightNumber(cookieValue) ?? 0;
        } catch {
          minHeight = 0;
        }
        syncMinHeightRef.current = minHeight;
        setSyncUnlocked(minHeight <= 0);
        setChainId(newChainId);
        setReady(true);
        setInitStage("Ready");
      } catch (e) {
        if (isMountedRef.current) {
          setInitError(String(e?.message || e));
          setInitStage("Initialization failed");
        }
      }
    } catch (e) {
      if (isMountedRef.current) {
        setInitError(String(e?.message || e));
        setInitStage("Initialization failed");
      }
    } finally {
      initInProgressRef.current = false;
    }
  }, [applicationId, faucetUrl]);

  useEffect(() => {
    initLinera();
  }, [initLinera]);

  useEffect(() => {
    if (!ready) return;
    startNotifications();
    if (syncUnlocked) {
      refresh();
    }
    const id = setInterval(() => {
      if (syncUnlocked && isMountedRef.current) refresh();
    }, 2500);
    return () => {
      clearInterval(id);
      if (refreshDebounceTimerRef.current) {
        clearTimeout(refreshDebounceTimerRef.current);
        refreshDebounceTimerRef.current = null;
      }
    };
  }, [ready, refresh, startNotifications, syncUnlocked]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (typeof notificationUnsubRef.current === "function") {
        try {
          notificationUnsubRef.current();
        } catch {}
        notificationUnsubRef.current = null;
      }
      if (refreshDebounceTimerRef.current) {
        clearTimeout(refreshDebounceTimerRef.current);
        refreshDebounceTimerRef.current = null;
      }
    };
  }, []);

  const createMatch = useCallback(
    async (hostName, totalRounds = 5) => {
      const name = escapeGqlString(hostName || defaultPlayerName(chainId));
      const rounds = Math.max(1, Math.min(20, Number(totalRounds) || 5));
      await gql(`mutation { createMatch(hostName: "${name}", totalRounds: ${rounds}) }`);
      await refresh();
    },
    [chainId, gql, refresh]
  );

  const joinMatch = useCallback(
    async (hostChainId, playerName) => {
      const host = escapeGqlString(hostChainId);
      const name = escapeGqlString(playerName || defaultPlayerName(chainId));
      await gql(`mutation { joinMatch(hostChainId: "${host}", playerName: "${name}") }`);
      await refresh();
    },
    [chainId, gql, refresh]
  );

  const submitWord = useCallback(
    async (word) => {
      const w = escapeGqlString(String(word || "").trim());
      await gql(`mutation { submitWord(word: "${w}") }`);
      await refresh();
    },
    [gql, refresh]
  );

  const leaveMatch = useCallback(async () => {
    await gql(`mutation { leaveMatch }`);
    await refresh();
  }, [gql, refresh]);

  const value = useMemo(
    () => ({
      ready,
      initError,
      initStage,
      chainId,
      applicationId,
      faucetUrl,
      syncHeight,
      syncUnlocked,
      finalResult,
      game,
      matchStatus,
      letters,
      round,
      roundPhase,
      isHost,
      opponentChainId,
      myWord,
      opponentWord,
      myScore,
      opponentScore,
      lastRoundRecord,
      roundHistory,
      lastNotification,
      setApplicationId,
      setFaucetUrl,
      refresh,
      createMatch,
      joinMatch,
      submitWord,
      leaveMatch,
    }),
    [
      applicationId,
      chainId,
      createMatch,
      finalResult,
      faucetUrl,
      game,
      initError,
      initStage,
      isHost,
      joinMatch,
      lastNotification,
      lastRoundRecord,
      letters,
      matchStatus,
      myScore,
      myWord,
      opponentChainId,
      opponentScore,
      opponentWord,
      round,
      roundHistory,
      roundPhase,
      ready,
      refresh,
      submitWord,
      leaveMatch,
      syncHeight,
      syncUnlocked,
    ]
  );

  return <LineraContext.Provider value={value}>{children}</LineraContext.Provider>;
};

export { LineraContextProvider, LineraContext };
