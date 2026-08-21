import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * EL NÚMERO DE ESTA COMPILACIÓN
 *
 * Se calcula una vez, al compilar, y va a dos sitios: dentro del paquete (como
 * __BUILD_ID__) y a un fichero suelto, dist/version.json.
 *
 * Para qué: el juego es una simulación determinista, así que dos jugadores con
 * versiones distintas del motor NO están jugando la misma partida — cada uno
 * calcula un ganador y la partida acaba en revisión sin repartir nada. Con esto,
 * el que lleva la versión vieja se entera y se recarga solo, en lugar de depender
 * de que alguien le diga «recarga» y le haga caso.
 *
 * El número es la fecha y hora de la compilación porque no hace falta más: lo
 * único que importa es que CAMBIE en cada despliegue.
 */
const BUILD_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    {
      name: 'plant-arena-version',
      // Al acabar de compilar se deja el número en un fichero aparte. El juego lo
      // pide de vez en cuando SIN caché y lo compara con el suyo; si no coinciden,
      // hay versión nueva. No hace falta tocar la base de datos ni acordarse de
      // nada después de desplegar: el fichero cambia solo en cada compilación.
      closeBundle() {
        writeFileSync(
          join('dist', 'version.json'),
          JSON.stringify({ build: BUILD_ID }) + '\n'
        )
      },
    },
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1500,
  },
})
