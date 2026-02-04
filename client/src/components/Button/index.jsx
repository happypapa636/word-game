import styles from "./styles.module.css";

const Button = ({ name, type, onClick, disabled }) => {
  return (
    <button
      className={`${styles.btn} ${disabled ? styles.btn_disabled : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {name}
    </button>
  );
};

export default Button;
