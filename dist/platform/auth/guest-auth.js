export class GuestAuth {
  id = 'guest';
  getSession() { return { provider: this.id, subject: 'guest', displayName: 'Guest' }; }
  async signIn() { return this.getSession(); }
  async signOut() {}
}
