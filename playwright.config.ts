import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // SwiftShader dibuja en la CPU y cada navegador ocupa varios núcleos. Con el default de Playwright (la mitad de los
  // núcleos: 5 en una máquina de 10), el juego corre mucho más lento que el reloj. Así, el feed de "partida completa" (5 s
  // de reloj) se apaga antes de que pasen los 2 s de partida del rifle, y el recorrido de tour.spec se pasa de sus 300 s.
  // Con 2, cada spec tarda poco más que sola.
  workers: 2,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
});
