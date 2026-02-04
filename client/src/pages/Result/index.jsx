import { useMemo, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { LineraContext } from "../../context/LineraContext";
import Button from "../../components/Button";
import styles from "./styles.module.css";

const Result = () => {
  const navigate = useNavigate();
  const {
    ready,
    finalResult,
    myScore,
    opponentScore,
    leaveMatch,
    chainId,
    game,
  } = useContext(LineraContext);

  const derivedScores = useMemo(() => {
    if (
      finalResult &&
      (Number(finalResult.myScore) !== undefined ||
        Number(finalResult.opponentScore) !== undefined)
    ) {
      return {
        mine: Number(finalResult.myScore ?? 0),
        opp: Number(finalResult.opponentScore ?? 0),
      };
    }
    return {
      mine: Number(myScore ?? 0),
      opp: Number(opponentScore ?? 0),
    };
  }, [finalResult, myScore, opponentScore]);

  const winnerChainId = finalResult?.winnerChainId ?? game?.winnerChainId ?? "";
  const didWin = useMemo(() => {
    if (!winnerChainId || winnerChainId === "") return null; // draw
    if (winnerChainId === chainId) return true;
    return false;
  }, [winnerChainId, chainId]);

  if (!ready) {
    return (
      <div className={styles.loading}>
        Loading...
      </div>
    );
  }

  let resultText = "DRAW";
  if (didWin === true) resultText = "YOU WIN!";
  if (didWin === false) resultText = "YOU LOSE";

  return (
    <div className={styles.container}>
      <div className={styles.result_card}>
        <div
          className={styles.title}
          style={{
            color:
              didWin === true
                ? "#00AA00"
                : didWin === false
                ? "#CC4444"
                : "#FFAA00",
          }}
        >
          {resultText}
        </div>
        <div className={styles.scores}>
          <div className={styles.score_item}>
            <div className={styles.score_label}>Your Score</div>
            <div className={styles.score_value}>{derivedScores.mine}</div>
          </div>
          <div className={styles.score_separator}>—</div>
          <div className={styles.score_item}>
            <div className={styles.score_label}>Opponent Score</div>
            <div className={styles.score_value}>{derivedScores.opp}</div>
          </div>
        </div>
        <div className={styles.btn_container}>
          <Button
            name="Back to Lobby"
            onClick={async () => {
              try {
                await leaveMatch();
              } finally {
                navigate("/");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Result;
