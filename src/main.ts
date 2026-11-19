import './style.css';
import { Game } from './core/Game';

const container = document.getElementById('app')!;
const loading = document.getElementById('loading');

try {
  const game = await Game.create(container);
  game.start();
  loading?.remove();

  // Vite HMR: stop the old loop when this module is replaced (full reload follows).
  import.meta.hot?.dispose(() => game.stop());
} catch (err) {
  console.error(err);
  if (loading) loading.textContent = `Failed to start: ${(err as Error).message}`;
}
