import { useState } from 'react';
import Shorts from './Shorts';
import './App.css';

type Page =
  | 'home'
  | 'image'
  | 'video'
  | 'audio'
  | 'avatar'
  | 'shorts'
  | 'projects'
  | 'credits';

const menu: { id: Page; icon: string; label: string }[] = [
  { id: 'home', icon: '⌂', label: 'Ana Sayfa' },
  { id: 'image', icon: '▧', label: 'AI Görsel' },
  { id: 'video', icon: '▶', label: 'AI Video' },
  { id: 'audio', icon: '♫', label: 'AI Ses' },
  { id: 'avatar', icon: '◉', label: 'AI Avatar' },
  { id: 'shorts', icon: '▣', label: 'DEMIVRA Shorts' },
  { id: 'projects', icon: '▤', label: 'Projelerim' },
  { id: 'credits', icon: '✧', label: 'Kredi Cüzdanı' },
];

const tools = [
  {
    id: 'image' as Page,
    icon: '▧',
    title: 'AI Görsel',
    desc: 'Metinden benzersiz görseller oluştur.',
    tag: 'GÖRSEL ÜRETİM',
  },
  {
    id: 'video' as Page,
    icon: '▶',
    title: 'AI Video',
    desc: 'Fikirlerini hareketli videolara dönüştür.',
    tag: 'VİDEO ÜRETİM',
  },
  {
    id: 'audio' as Page,
    icon: '♫',
    title: 'AI Ses',
    desc: 'Seslendirme, müzik ve ses efektleri üret.',
    tag: 'SES STÜDYOSU',
  },
  {
    id: 'avatar' as Page,
    icon: '◉',
    title: 'AI Avatar',
    desc: 'Yapay zekâ avatarlarıyla içerik oluştur.',
    tag: 'AVATAR STÜDYOSU',
  },
];

function App() {
  const [page, setPage] = useState<Page>('home');
  const [prompt, setPrompt] = useState('');

  const active = menu.find((item) => item.id === page);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol">D</div>
          <div>
            <div className="brand-name">DEMIVRA</div>
            <div className="brand-sub">AI CREATIVE STUDIO</div>
          </div>
        </div>

        <div className="menu-label">ÇALIŞMA ALANI</div>
        <nav className="navigation">
          {menu.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'shorts' && <span className="new-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="credit-card">
            <div className="credit-icon">✧</div>
            <div className="credit-title">DEMIVRA Kredileri</div>
            <div className="credit-value">
              0 <span>kredi</span>
            </div>
            <button onClick={() => setPage('credits')}>
              Kredi sistemini incele →
            </button>
          </div>
          <div className="profile">
            <div className="profile-avatar">D</div>
            <div>
              <strong>DEMIVRA Üyesi</strong>
              <span>Ücretsiz hesap</span>
            </div>
            <span className="profile-more">•••</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            DEMIVRA <span>/</span> {active?.label}
          </div>
          <div className="top-actions">
            <span className="status">
              <i /> Sistem hazır
            </span>
            <button
              className="upgrade-button"
              onClick={() => setPage('credits')}
            >
              ✧ Planları keşfet
            </button>
          </div>
        </header>

        {page === 'home' && (
          <div className="page-content">
            <section className="welcome">
              <div className="welcome-copy">
                <div className="eyebrow">
                  <span /> YENİ NESİL YAPAY ZEKÂ STÜDYOSU
                </div>
                <h1>
                  Hayal et.
                  <br />
                  <span>DEMIVRA</span> üretsin.
                </h1>
                <p>
                  Görsel, video, ses ve yaratıcı projelerin için ihtiyacın olan
                  her şey tek bir yerde.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setPage('image')}
                >
                  Üretmeye başla <span>→</span>
                </button>
              </div>
              <div className="welcome-art">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="art-core">
                  D<span>✧</span>
                </div>
                <div className="floating-card card-one">
                  ✦ <span>AI CREATIVE</span>
                </div>
                <div className="floating-card card-two">
                  ◈ <span>YOUR IDEAS</span>
                </div>
                <div className="floating-card card-three">
                  ◉ <span>INFINITE</span>
                </div>
              </div>
            </section>

            <div className="section-heading">
              <div>
                <span className="section-kicker">ARAÇLARINI KEŞFET</span>
                <h2>Yaratıcılık araçları</h2>
              </div>
              <span className="section-note">
                Tek platform. Sınırsız fikir.
              </span>
            </div>

            <section className="tool-grid">
              {tools.map((tool) => (
                <button
                  className="tool-card"
                  key={tool.id}
                  onClick={() => setPage(tool.id)}
                >
                  <div className="tool-top">
                    <span className="tool-icon">{tool.icon}</span>
                    <span className="tool-arrow">↗</span>
                  </div>
                  <span className="tool-tag">{tool.tag}</span>
                  <h3>{tool.title}</h3>
                  <p>{tool.desc}</p>
                </button>
              ))}
            </section>

            <section className="shorts-banner">
              <div className="shorts-symbol">▶</div>
              <div className="shorts-copy">
                <span className="section-kicker">DEMIVRA'NIN ÖZEL ARACI</span>
                <h2>DEMIVRA SHORTS</h2>
                <p>
                  Uzun videolarını keşfet, kısa içeriklerini hazırla ve Shorts
                  çalışma alanında düzenle.
                </p>
              </div>
              <button
                className="shorts-button"
                onClick={() => setPage('shorts')}
              >
                Shorts'u aç <span>→</span>
              </button>
            </section>

            <div className="footer-note">
              DEMIVRA © 2026 <span>Yaratıcılığın yeni adresi.</span>
            </div>
          </div>
        )}

        {page === 'shorts' && <Shorts />}

        {page === 'image' && (
          <GeneratorPage
            title="AI Görsel"
            subtitle="Aklındaki görseli kelimelere dök, DEMIVRA ile hayata geçir."
            prompt={prompt}
            setPrompt={setPrompt}
          />
        )}
        {page === 'video' && (
          <GeneratorPage
            title="AI Video"
            subtitle="Fikirlerini hareketli sahnelere dönüştür."
            prompt={prompt}
            setPrompt={setPrompt}
          />
        )}
        {page === 'audio' && (
          <GeneratorPage
            title="AI Ses"
            subtitle="Seslendirme ve yaratıcı ses projelerin için yeni alanın."
            prompt={prompt}
            setPrompt={setPrompt}
          />
        )}
        {page === 'avatar' && (
          <GeneratorPage
            title="AI Avatar"
            subtitle="Dijital karakterlerini ve avatar fikirlerini oluştur."
            prompt={prompt}
            setPrompt={setPrompt}
          />
        )}

        {page === 'projects' && (
          <div className="page-content">
            <div className="page-heading">
              <span className="section-kicker">ÇALIŞMA ALANIN</span>
              <h1>Projelerim</h1>
              <p>Oluşturduğun içerikler burada toplanacak.</p>
            </div>
            <div className="empty-state">
              <div>▤</div>
              <h2>Henüz projen yok</h2>
              <p>İlk yaratıcı projen için araçlardan birini seç.</p>
              <button
                className="primary-button"
                onClick={() => setPage('image')}
              >
                İlk projeni oluştur →
              </button>
            </div>
          </div>
        )}

        {page === 'credits' && (
          <div className="page-content">
            <div className="page-heading">
              <span className="section-kicker">DEMIVRA CÜZDAN</span>
              <h1>Kredi sistemi</h1>
              <p>
                AI araçlarını kullanmak için kredi altyapısı burada yer alacak.
              </p>
            </div>
            <div className="credit-overview">
              <span>MEVCUT BAKİYE</span>
              <strong>
                0 <small>kredi</small>
              </strong>
              <p>
                Kredi satın alma ve kullanım sistemi henüz etkinleştirilmedi.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function GeneratorPage({
  title,
  subtitle,
  prompt,
  setPrompt,
}: {
  title: string;
  subtitle: string;
  prompt: string;
  setPrompt: (value: string) => void;
}) {
  return (
    <div className="page-content">
      <div className="page-heading">
        <span className="section-kicker">DEMIVRA CREATIVE LAB</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="generator-box">
        <label>NE OLUŞTURMAK İSTİYORSUN?</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Fikrini buraya yaz..."
        />
        <div className="generator-bottom">
          <span>Yaratıcılığını kelimelerle anlat.</span>
          <button
            disabled={!prompt.trim()}
            onClick={() =>
              alert('AI üretim servisini bir sonraki aşamada bağlayacağız.')
            }
          >
            Üretim servisini bağla →
          </button>
        </div>
      </div>
      <div className="notice">
        Bu modülün arayüzü hazır. Gerçek üretim için uygun AI servis bağlantısı
        ve API yapılandırması gerekecek.
      </div>
    </div>
  );
}

export default App;
