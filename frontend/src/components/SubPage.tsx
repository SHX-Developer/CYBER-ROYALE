// Старая обёртка с back-кнопкой больше не используется — теперь у нас
// постоянная нижняя навигация через ShellLayout. Оставлено как заглушка
// на случай, если понадобится вложенная страница в будущем.
export default function SubPage(props: { title?: string; children?: React.ReactNode }) {
  return (
    <div style={{ padding: 16 }}>
      {props.title && <h2 style={{ margin: 0 }}>{props.title}</h2>}
      {props.children}
    </div>
  );
}
