// Decoy: *.spec.ts files must be excluded by the scanner. The endpoint
// below must never appear in the inventory.
import { Controller, Get } from '@nestjs/common';

@Controller('spec-decoy')
class SpecDecoyController {
  @Get('should-not-appear')
  shouldNotAppear(): string {
    return 'nope';
  }
}

describe('UsersController', () => {
  it('is a decoy', () => {
    expect(SpecDecoyController).toBeDefined();
  });
});
