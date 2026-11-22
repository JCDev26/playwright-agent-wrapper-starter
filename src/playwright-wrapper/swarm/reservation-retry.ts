/** A single caller and one trusted process for the lifetime of a reservation exercise. */
export class ReservationDesk {
  private readonly requests = new Map<string, { room: string; reservation: number }>();

  reserve(requestId: string, room: string): number {
    const previous = this.requests.get(requestId);
    if (previous) {
      if (previous.room !== room) throw new Error("Request ID already belongs to a different reservation intent.");
      return previous.reservation;
    }
    const reservation = this.requests.size + 1;
    this.requests.set(requestId, { room, reservation });
    return reservation;
  }

  /** The operator inspects the resulting bookings independently of the client's reply. */
  bookingsFor(room: string): number[] {
    return [...this.requests.values()].filter(entry => entry.room === room).map(entry => entry.reservation);
  }
}
