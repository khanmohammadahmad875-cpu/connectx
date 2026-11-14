// The shared Reels interest list. This is the server copy of the ONE list:
// the client keeps an identical copy in client/src/utils/interests.js.
// Interests are validated against this list on every write (preferences and
// reel creation), so a value outside it can never be stored.
const REEL_INTERESTS = [
  'Funny',
  'Islamic',
  'Tech',
  'Study',
  'Sports',
  'Music',
  'Food',
  'Travel',
  'Gaming',
  'Motivation',
  'Fashion',
  'News',
];

module.exports = { REEL_INTERESTS };
