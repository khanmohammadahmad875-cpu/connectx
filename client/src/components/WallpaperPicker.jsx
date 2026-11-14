import { useRef, useState } from 'react';
import { uploadFile } from '../services/api';
import { WALLPAPERS, wallpaperSwatchStyle } from '../utils/wallpapers';

// Wallpaper picker (module 25): built-in CSS wallpapers + a custom uploaded
// image + a dim slider. Presentational — the parent decides what selecting
// means (global default vs per-conversation) and persists it.
export default function WallpaperPicker({ wallpaper, customWallpaperUrl, dim, onChange, onDimChange }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function pickCustom(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(file);
      if (result.messageType !== 'image') throw new Error('Please choose an image file');
      onChange('custom', result.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="wp-picker">
      <div className="wp-grid">
        {WALLPAPERS.map((w) => (
          <button
            key={w.key}
            type="button"
            className={`wp-swatch ${wallpaper === w.key ? 'selected' : ''}`}
            style={wallpaperSwatchStyle(w.key, customWallpaperUrl)}
            onClick={() => {
              if (w.key === 'custom' && !customWallpaperUrl) {
                fileRef.current?.click();
              } else {
                onChange(w.key, customWallpaperUrl);
              }
            }}
            title={w.name}
          >
            <span className="wp-swatch-name">{w.name}</span>
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={pickCustom}
      />
      <div className="wp-actions">
        <button type="button" className="btn small ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload custom image'}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <label className="wp-dim">
        <span>Dim overlay · {dim}%</span>
        <input
          type="range"
          min="0"
          max="85"
          step="5"
          value={dim}
          onChange={(e) => onDimChange(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
