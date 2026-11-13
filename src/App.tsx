import { useState } from 'react';
import './App.css';

function App() {
  const [video, setVideo] = useState<File | null>(null);

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          DEMIVRA <span>SHORTS</span>
        </div>
        <div className="status">ÜCRETSİZ KULLANIM</div>
      </header>

      <main className="main">
        <div className="tag">YENİ NESİL VİDEO DÖNÜŞTÜRÜCÜ</div>
        <h1>
          Videonu yükle.
          <br />
          <span>Shorts'a dönüştür.</span>
        </h1>
        <p className="description">
          Uzun videolarını dikey kısa videolara dönüştür.
        </p>

        <div className="converter">
          <label>Bilgisayarından video seç</label>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setVideo(e.target.files?.[0] || null)}
          />

          {video && <p>Seçilen video: {video.name}</p>}

          <button
            onClick={() =>
              alert(
                video
                  ? 'Video başarıyla seçildi! Dönüştürme motorunu şimdi ekleyeceğiz.'
                  : 'Önce bir video seç.'
              )
            }
          >
            SHORTS OLUŞTUR →
          </button>

          <small>MP4, MOV ve diğer video dosyalarını seçebilirsin.</small>
        </div>
      </main>

      <footer>© 2026 DEMIVRA SHORTS</footer>
    </div>
  );
}

export default App;
