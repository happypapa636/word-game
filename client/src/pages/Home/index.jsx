import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button";
import { LineraContext } from "../../context/LineraContext";
import styles from "./styles.module.css";

const PLAYER_NAME_STORAGE_KEY = "word_duel_player_name";

const Home = () => {
  const navigate = useNavigate();
  const { ready, initError, chainId, createMatch } = useContext(LineraContext);
  const [friendMenuOpen, setFriendMenuOpen] = useState(false);
  const [hostChainIdInput, setHostChainIdInput] = useState("");
  const [totalRounds, setTotalRounds] = useState(5);
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const normalizedPlayerName = useMemo(
    () => String(playerName || "").trim(),
    [playerName]
  );

  const normalizedHostChainId = useMemo(
    () => String(hostChainIdInput || "").trim(),
    [hostChainIdInput]
  );

  const canJoin = useMemo(() => {
    if (!ready) return false;
    if (!normalizedHostChainId) return false;
    return true;
  }, [normalizedHostChainId, ready]);

  const canOpenMenus = normalizedPlayerName.length > 0;

  return (
    <>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Word Duel</h1>
          <p className={styles.subtitle}>On-Chain Word Game on Linera</p>
        </div>

        <div className={styles.content}>
          <div className={styles.name_block}>
            <input
              className={styles.input}
              value={playerName}
              onChange={(e) => {
                const next = e.target.value;
                setPlayerName(next);
                try {
                  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, next);
                } catch {}
              }}
              placeholder="Enter your name"
            />
          </div>

          <div className={styles.btn_container}>
            <Button
              name="Play with Friend"
              type="friend"
              disabled={!canOpenMenus}
              onClick={() => setFriendMenuOpen(true)}
            />
          </div>
        </div>
      </div>

      {friendMenuOpen && (
        <div
          className={styles.modal_backdrop}
          onClick={() => setFriendMenuOpen(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modal_header}>
              <div className={styles.modal_title}>PLAY WITH FRIEND</div>
              <button
                className={styles.modal_close}
                type="button"
                onClick={() => setFriendMenuOpen(false)}
              >
                ✕
              </button>
            </div>

            {!ready && (
              <div className={styles.modal_hint}>
                {initError
                  ? `Linera init error: ${initError}`
                  : "Initializing Linera..."}
              </div>
            )}

            {ready && (
              <>
                <div className={styles.section}>
                  <div className={styles.section_title}>CREATE ROOM</div>
                  <div className={styles.section_hint}>
                    Your room id: <span className={styles.mono}>{chainId}</span>
                  </div>
                  <div className={styles.rounds_row}>
                    <label className={styles.rounds_label}>Rounds:</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className={styles.rounds_input}
                      value={totalRounds}
                      onChange={(e) =>
                        setTotalRounds(
                          Math.max(1, Math.min(20, Number(e.target.value) || 5))
                        )
                      }
                    />
                  </div>
                  <Button
                    name="Create Room"
                    onClick={async () => {
                      await createMatch(normalizedPlayerName, totalRounds);
                      setFriendMenuOpen(false);
                      navigate(`/room/${chainId}`);
                    }}
                  />
                </div>

                <div className={styles.divider} />

                <div className={styles.section}>
                  <div className={styles.section_title}>JOIN ROOM</div>
                  <div className={styles.section_hint}>
                    Enter host room id and join.
                  </div>
                  <input
                    className={styles.input}
                    value={hostChainIdInput}
                    onChange={(e) => setHostChainIdInput(e.target.value)}
                    placeholder="Host chain id"
                  />
                  <Button
                    name="Join Room"
                    disabled={!canJoin}
                    onClick={() => {
                      if (!canJoin) return;
                      setFriendMenuOpen(false);
                      const name = normalizedPlayerName;
                      const q = name
                        ? `?name=${encodeURIComponent(name)}`
                        : "";
                      navigate(`/room/${normalizedHostChainId}${q}`);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default Home;
