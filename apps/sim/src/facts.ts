import type { NavPlace } from '@ethmumbai/protocol/Intent'
import type { SimWorld } from './bridge.ts'
import type { Stall } from './scene.ts'

// What the duck "knows" about the hall, as text for 0G: built from scene state (the stalls, their screens and gates,
// the duck's pose), never from camera pixels. Menus and signs are the merchant's text; the Worker's prompt tells the
// model not to follow them.

const menuOf = (stall: Stall) => ({ item: stall.id, name: stall.name, price: `${stall.price} USDC` })

const screenFact = (stall: Stall) => {
  const screen = stall.screen()
  if (screen.kind === 'qr') return `The ${stall.name} screen shows a payment QR code for one ${stall.name}.`
  return screen.tone === 'paid'
    ? `The ${stall.name} screen says PAID; the gate beside the counter is open.`
    : `The ${stall.name} screen shows no QR code right now (${screen.text}).`
}

const stallAt = (world: SimWorld, place: NavPlace | null) => world.cafe.stalls.find((stall) => stall.place === place)

/** The `look` result: where the duck is, plain facts, and the menu it can read from there. */
export const describePlace = (world: SimWorld, place: NavPlace | null) => {
  const stall = stallAt(world, place)
  if (stall !== undefined)
    return {
      place,
      facts: [
        `The Duck Café ${stall.name} stall: a counter with one item.`,
        screenFact(stall),
        `The gate arm beside the counter is ${stall.gate.open ? 'open' : 'closed'}.`,
      ],
      menu: [menuOf(stall)],
    }
  if (place === 'gate')
    return {
      place,
      facts: [`The exit gate is ${world.cafe.exitGate.open ? 'open' : 'closed'}. It opens when an order is paid.`],
      menu: [],
    }
  return {
    place,
    facts: [
      place === 'entrance'
        ? 'The Duck Café entrance. Three stalls stand ahead, each with a sign and a payment screen.'
        : 'Between places in the Duck Café hall.',
      ...world.cafe.stalls.map((each) => `The ${each.name} stall's sign reads "${each.name} · ${each.price} USDC".`),
    ],
    menu: world.cafe.stalls.map(menuOf),
  }
}

/** The per-turn `scene` text (≤ 2000 characters): pose, place, the places and what the camera sees. */
export const describeScene = (world: SimWorld) => {
  const [x, y, yaw] = world.body.pose()
  const place = world.cafe.placeAt(x, y)
  const sighting = world.camera.sighting(1500)
  const stalls = world.cafe.stalls
    .map((stall) => `${stall.place} (${stall.name} ${stall.price} USDC, gate ${stall.gate.open ? 'open' : 'closed'})`)
    .join(', ')
  return [
    `at: ${place ?? 'between places'}`,
    `pose: x ${x.toFixed(2)} m, y ${y.toFixed(2)} m, heading ${Math.round((yaw * 180) / Math.PI)}°`,
    `places: entrance, ${stalls}, gate (exit, ${world.cafe.exitGate.open ? 'open' : 'closed'})`,
    `camera: ${sighting === null ? 'no payment QR in view' : 'a payment QR code is in view'}`,
    world.body.fallen() ? 'body: fallen' : 'body: standing',
  ]
    .join('\n')
    .slice(0, 2000)
}
