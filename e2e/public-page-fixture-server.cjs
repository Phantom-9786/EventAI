const http = require('node:http');

const venue = {
  id: 'venue-e2e',
  name: 'Fixture Arts Hall',
  description: 'A controlled public venue fixture.',
  address: '123 Example Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  zipCode: '400001',
  country: 'India',
  latitude: 19.076,
  longitude: 72.8777,
  capacity: 250,
  images: [],
  amenities: ['Accessible seating'],
  organizer: { id: 'organizer-e2e', organizationName: 'Fixture Organizer', isVerified: true },
  seatSections: [],
  _count: { events: 1 },
};

const event = {
  id: 'event-e2e',
  title: 'Fixture Live Event',
  slug: 'fixture-live-event',
  shortDescription: 'A controlled event fixture.',
  description: 'An event used only by the public page browser tests.',
  startDate: '2030-06-01T18:00:00.000Z',
  endDate: '2030-06-01T21:00:00.000Z',
  images: [],
  isFeatured: false,
  minPrice: null,
  maxPrice: null,
  category: { id: 'category-e2e', name: 'Music', slug: 'music', icon: null, color: null },
  venue: {
    id: venue.id,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    state: venue.state,
    country: venue.country,
    latitude: venue.latitude,
    longitude: venue.longitude,
  },
  organizer: {
    id: 'organizer-e2e',
    organizationName: 'Fixture Organizer',
    logo: null,
    isVerified: true,
  },
  ticketTypes: [],
  tags: [],
  policies: null,
  cancellationPolicy: null,
  faqs: [],
};

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/health') {
    response.end(JSON.stringify({ status: 'ok' }));
  } else if (request.url === '/api/venues/venue-e2e') {
    response.end(JSON.stringify({ venue }));
  } else if (request.url === '/api/events/fixture-live-event') {
    response.end(JSON.stringify({ event }));
  } else if (request.url === '/api/events/fixture-live-event/similar?limit=4') {
    response.end(JSON.stringify({ events: [] }));
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'Fixture API route not found' }));
  }
});

server.listen(4100, '127.0.0.1');
