require('dotenv').config();

module.exports = {
  // Login credentials
  username: process.env.BR_USERNAME,
  password: process.env.BR_PASSWORD,
  baseUrl: process.env.BR_BASE_URL || 'https://oudenrijn.baanreserveren.nl',

  // Sport & court IDs
  sportId: '841',        // Padel
  courts: [
    { name: 'Padel 1', resourceId: '2615' },
    { name: 'Padel 2', resourceId: '2616' },
  ],

  // Players to add (Speler 2, 3, 4 — Speler 1 is the logged-in user)
  players: [
    'Hugo Mink',
    'Menno Ekelschot',
    'Robin Meijer',
  ],

  // Booking preferences — ordered by priority (highest first)
  // dayOfWeek: 1 = Monday, 2 = Tuesday, 3 = Wednesday (ISO weekday)
  // No preference between 19:00 and 20:00 — both are equally listed per day
  slotPreferences: [
    { dayOfWeek: 1, startHour: 19, label: 'Maandag 19:00-20:00' },
    { dayOfWeek: 1, startHour: 20, label: 'Maandag 20:00-21:00' },
    { dayOfWeek: 2, startHour: 19, label: 'Dinsdag 19:00-20:00' },
    { dayOfWeek: 2, startHour: 20, label: 'Dinsdag 20:00-21:00' },
    { dayOfWeek: 3, startHour: 19, label: 'Woensdag 19:00-20:00' },
    { dayOfWeek: 3, startHour: 20, label: 'Woensdag 20:00-21:00' },
  ],

  // Test slot: Sunday 11:00 (for a test reservation)
  testSlot: { dayOfWeek: 0, startHour: 11, label: 'Zondag 11:00-12:00' },

  // Reservation horizon in days
  horizonDays: 14,

  // Duration of a reservation in minutes
  durationMinutes: 60,
};
