const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const requestCount = Number(process.env.REQUESTS || 100);

async function run() {
  const seatsResponse = await fetch(`${baseUrl}/seats`);
  if (!seatsResponse.ok) throw new Error(`Seat request failed: ${seatsResponse.status}`);
  const seats = (await seatsResponse.json()).seats;
  const seat = seats.find(item => item.status === 'available');
  if (!seat) throw new Error('No available seat found');

  const responses = await Promise.all(Array.from({ length: requestCount }, async (_, index) => {
    const response = await fetch(`${baseUrl}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `concurrency-${Date.now()}-${index}`
      },
      body: JSON.stringify({ seatId: seat.id, userId: `concurrency-user-${index}` })
    });
    return { status: response.status, body: await response.json() };
  }));

  const created = responses.filter(result => result.status === 201).length;
  const conflicts = responses.filter(result => result.status === 409).length;
  const other = responses.filter(result => ![201, 409].includes(result.status));
  process.stdout.write(JSON.stringify({ seat: seat.seat_number, attempted: requestCount, reservationsCreated: created, conflicts, unexpectedResponses: other }, null, 2) + '\n');
  if (created !== 1 || conflicts !== requestCount - 1 || other.length) process.exitCode = 1;
}

run().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
