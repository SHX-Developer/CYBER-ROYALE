import { useUiStore } from '@/store/uiStore';

interface Props {
  title: string;
  children?: React.ReactNode;
}

export default function SubPage({ title, children }: Props) {
  const setScreen = useUiStore((s) => s.setScreen);

  return (
    <div style={page}>
      <header style={topBar}>
        <button onClick={() => setScreen('menu')} style={backBtn} aria-label="Назад">
          ←
        </button>
        <h2 style={titleStyle}>{title}</h2>
        <span style={{ width: 36 }} />
      </header>

      <main style={main}>{children ?? <Placeholder />}</main>
    </div>
  );
}

function Placeholder() {
  return (
    <div style={{ opacity: 0.5, textAlign: 'center', padding: 40 }}>
      Раздел появится на следующих этапах.
    </div>
  );
}

const page: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const topBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid #1a2030',
  background: '#0b0d12',
};

const backBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid #2a3142',
  background: '#151a25',
  color: '#e7ecf3',
  fontSize: 18,
  cursor: 'pointer',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  letterSpacing: 1,
};

const main: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 16,
};
