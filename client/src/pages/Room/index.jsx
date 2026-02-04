import { useEffect, useContext, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { LineraContext } from "../../context/LineraContext";
import Button from "../../components/Button";
import styles from "./styles.module.css";

const PLAYER_NAME_STORAGE_KEY = "word_duel_player_name";

const normalizePhase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const Room = () => {
  const [wordInput, setWordInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    ready,
    initError,
    chainId,
    syncUnlocked,
    game,
    isHost,
    opponentChainId,
    matchStatus,
    letters,
    round,
    roundPhase,
    myWord,
    opponentWord,
    myScore,
    opponentScore,
    lastRoundRecord,
    joinMatch,
    submitWord,
    lastNotification,
  } = useContext(LineraContext);
  const hasJoinedRef = useRef(false);
  const resultNavTriggeredRef = useRef(false);
  const totalRoundsVal = game?.totalRounds ?? 5;

  useEffect(() => {
    if (!ready) return;
    if (!syncUnlocked) return;
    if (!id) return;
    if (!chainId) return;

    if (id === chainId) {
      return;
    }

    if (hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    const params = new URLSearchParams(location.search || "");
    let playerName = String(params.get("name") || "").trim();
    if (!playerName) {
      try {
        playerName = String(
          localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || ""
        ).trim();
      } catch {
        playerName = "";
      }
    }
    joinMatch(id, playerName || undefined).catch(() => {
      hasJoinedRef.current = false;
      navigate("/");
    });
  }, [chainId, id, joinMatch, location.search, navigate, ready, syncUnlocked]);

  useEffect(() => {
    if (!ready) return;
    if (!syncUnlocked) return;
    if (resultNavTriggeredRef.current) return;

    const statusStr = normalizePhase(game?.status ?? matchStatus);
    const ended = statusStr === "ended";
    if (!ended) return;

    resultNavTriggeredRef.current = true;
    navigate("/result");
  }, [game?.status, matchStatus, navigate, ready, syncUnlocked]);

  const phaseStr = normalizePhase(roundPhase);
  const isHostTurn = phaseStr === "hosttoplay";
  const isGuestTurn = phaseStr === "guesttoplay";
  const myTurn =
    (isHost && isHostTurn) || (!isHost && isGuestTurn);
  const canSubmit =
    myTurn && !myWord && wordInput.trim().length >= 3 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const w = wordInput.trim();
    if (w.length < 3) return;
    setSubmitting(true);
    try {
      await submitWord(w);
      setWordInput("");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div className={styles.loading}>
        {initError
          ? `Linera init error: ${initError}`
          : "Initializing Linera..."}
      </div>
    );
  }

  if (!syncUnlocked) {
    return <div className={styles.loading}>Syncing chain...</div>;
  }

  return (
    <>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Word Duel</h1>
          <div className={styles.round_info}>
            Round {round} / {totalRoundsVal}
          </div>
        </div>

        <div className={styles.letters_block}>
          <div className={styles.letters_label}>Letters:</div>
          <div className={styles.letters_display}>
            {letters
              ? letters
                  .split("")
                  .map((c, i) => (
                    <span key={i} className={styles.letter}>
                      {c}
                    </span>
                  ))
              : "—"}
          </div>
        </div>

        <div className={styles.scores_block}>
          <div className={styles.score_box}>
            <div className={styles.score_label}>You</div>
            <div className={styles.score_value}>{myScore}</div>
          </div>
          <div className={styles.score_sep}>—</div>
          <div className={styles.score_box}>
            <div className={styles.score_label}>Opponent</div>
            <div className={styles.score_value}>{opponentScore}</div>
          </div>
        </div>

        {opponentChainId ? (
          <>
            {lastRoundRecord && (
              <div className={styles.last_round}>
                <div className={styles.last_round_title}>Last round</div>
                <div className={styles.last_round_words}>
                  <span>Host: {lastRoundRecord.hostWord || "—"}</span>
                  <span>Guest: {lastRoundRecord.guestWord || "—"}</span>
                </div>
                <div className={styles.last_round_points}>
                  +{lastRoundRecord.hostPoints} / +{lastRoundRecord.guestPoints}
                </div>
              </div>
            )}

            <div className={styles.input_block}>
              <input
                className={styles.word_input}
                value={wordInput}
                onChange={(e) => setWordInput(e.target.value.toUpperCase())}
                placeholder="Enter a word (min 3 letters)"
                maxLength={letters?.length || 10}
                disabled={!myTurn || !!myWord}
              />
              <Button
                name="Submit Word"
                disabled={!canSubmit}
                onClick={handleSubmit}
              />
            </div>

            {myWord && (
              <div className={styles.my_word_display}>
                Your word: <strong>{myWord}</strong>
              </div>
            )}
            {opponentWord && !myWord && (
              <div className={styles.opponent_word_display}>
                Opponent word: <strong>{opponentWord}</strong>
              </div>
            )}
            {myTurn && !myWord && (
              <div className={styles.turn_hint}>Your turn — submit a word</div>
            )}
            {!myTurn && !opponentWord && (
              <div className={styles.turn_hint}>Waiting for opponent...</div>
            )}
            {lastNotification && (
              <div className={styles.notification}>{lastNotification}</div>
            )}
          </>
        ) : (
          <div className={styles.waiting}>
            <div className={styles.waiting_text}>
              Waiting for opponent to join...
            </div>
            <div className={styles.room_id}>Room ID: {chainId}</div>
          </div>
        )}
      </div>
    </>
  );
};

export default Room;
