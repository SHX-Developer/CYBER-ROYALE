import Phaser from 'phaser';

// Скелет Phaser-сцены. Полноценная арена появится на следующем этапе.
class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0b0d12');
    this.add
      .text(width / 2, height / 2, 'CYBER ROYALE\nphaser ready', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#e7ecf3',
        align: 'center',
      })
      .setOrigin(0.5);
  }
}

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0d12',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 360,
      height: 720, // вертикальный экран
    },
    scene: [BootScene],
  });
}
