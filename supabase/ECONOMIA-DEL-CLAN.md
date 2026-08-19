# Economía del clan

Decidido por el dueño del juego. Esto es la especificación que debe seguir la
migración del clan cuando se construya. **Nada de esto está implementado
todavía**: hoy el clan entero vive en `localStorage` y ningún coste en gemas se
cobra de verdad (ver «Estado actual» al final).

## A dónde va cada gema

| Cobro | Importe | Destino | ¿Retirable? |
|---|---|---|---|
| Fundar un clan | 5 gemas | **El proyecto** (ingreso de la casa) | no llega al tesoro |
| Entrar a un clan | 2 gemas | **Tesoro del clan** | no: es el suelo permanente |
| Depositar gemas | lo que ponga | Tesoro del clan | no: ya se cobró en premios |
| Ganancias de asalto | lo que se gane | Tesoro del clan | **sí** |

El suelo de un clan lleno son **28 gemas** (14 entradas; el fundador ya pagó sus
5 al proyecto). Ese suelo no se devuelve nunca: es el saldo permanente del clan.

**Sólo se retira lo que crece por encima del suelo.** Las ganancias vienen de
asaltar a otros clanes, no de aportar. Es la regla que hace que el tesoro sea
algo que el clan hace crecer peleando y no una cuenta de ahorros donde cada uno
mete y saca lo suyo.

## Por qué esto no imprime gemas

Un asalto mueve gemas de un tesoro a otro: lo que gana un clan lo pierde otro.
Suma cero entre clanes. La casa se queda los 5 de cada fundación, el 20% de cada
pozo del coliseo, y los depósitos.

Queda **un solo punto que pierde dinero**, y hay que decidirlo antes de abrir al
público:

> Depositar 1 gema da 1 ticket de coliseo + 1 tirada de ruleta.
> Una tirada cuesta 1 gema. Un ticket lo subvenciona la casa a 0,5.
> O sea: entra 1 gema y salen ~1,5 gemas de valor.

**Decisión: se acepta esa pérdida por ahora**, a cambio de incentivar que la
gente deposite y el clan arranque. Se compensa por dos vías:

- **Bajando el valor esperado de la ruleta**: más peso al sector «sigue
  intentando». Una tirada deja de valer 1 gema en la práctica, así que el
  desequilibrio se cierra sin tocar el premio del depósito. Los pesos ya viven en
  `lottery_sectors.weight`, editables desde el panel de administración.
- **Vigilando los tickets**: si se acumulan más de los que se gastan, el ticket
  deja de ser un incentivo y pasa a ser inflación. Es el número a mirar las
  primeras semanas.

**Idea para más adelante: la hora loca.** Depositar da tickets sólo durante una
ventana de tiempo (una hora al día, o ciertos días). Concentra la actividad,
convierte el premio en un evento y acota el coste sin quitarle atractivo. Es
mejor palanca que rebajar el premio, porque el jugador siente que gana algo
especial en lugar de que le han recortado.

Las tres opciones que quedan sobre la mesa si hiciera falta apretar:

1. **1 gema → 1 ticket + 1 tirada** ← lo que se hace ahora.
2. **1 gema → 1 ticket, y 1 tirada por cada 5 gemas.**
3. **1 gema → 1 ticket.** La casa se queda 0,5.

Los premios van en tabla de configuración, como los precios de la tienda
(`shop_config`) y el oro de los cofres (`chest_rewards`), para poder reequilibrar
sin volver a tocar SQL. La ventana de la hora loca, cuando se haga, también.

## Cómo repartir el botín entre los miembros

El problema no es el porcentaje: es **qué se mide**. Lo que se mida es lo que la
gente hará.

- Repartir por gemas depositadas → cada uno mete y saca lo suyo, nadie colabora.
- Repartir a partes iguales → premia igual al que peleó todas las guerras y al
  que se apuntó y desapareció. Los que pelean se van.
- Un solo ganador → catorce se van.
- **Repartir por participación en guerra** (ataques hechos o daño causado) → la
  única forma de cobrar es jugar. Es lo que se busca.

Con tres frenos, que importan más que la fórmula:

- **Suelo de participación.** Cero ataques en la temporada, cero botín.
- **Techo por miembro** (p. ej. 30%). Si uno se lleva el 80%, los otros trece
  dejan de jugar y el clan muere igual.
- **Antifrancotirador.** Peso por días en el clan durante la temporada, o no
  cobra quien entró en la última semana. Si no, se llenan los clanes ganadores
  el último día.

## Estado actual (2026-08-19)

Nada de lo de arriba existe en la base. Lo que hay:

- `src/utils/clanManager.ts` guarda clanes, miembros y tesoro en `localStorage`.
  Cada navegador tiene su propia lista: dos jugadores no pueden verse ni unirse
  al mismo clan.
- `deductUserTokens` (`src/hooks/useInventory.ts`) sólo cambia el estado de React
  y `localStorage`. Fundar, entrar, depositar, reparar y asaltar **no cobran
  nada real**; el servidor sobrescribe el saldo en la siguiente sincronización.
- `Clan.tsx` reparte el tesoro al jugador con `onAddTokens`.

**Al no estar migrado nada, hoy no hay robo posible**: la función simplemente no
funciona de verdad. Eso es más seguro que estarlo a medias, y por eso no bloquea
la apertura del registro público. Pero el reparto desde el cliente sería un
impresor de gemas en cuanto el tesoro fuera real, así que **no se implementa el
reparto en el cliente**: va por RPC como el resto.

Las tablas ya existen en `schema.sql` (`clans`, `clan_members`,
`clan_donations`, `clan_war_attacks`) y no las usa nadie.
