# Spring demo change overlay

Files here replace or add files in `../spring/` to simulate the code change in
the MonoField interface-spec demo (`docs/demo/spring-interface-spec-demo.md`):

- `OrderCreateRequest.deliveryMemo` — new optional request field.
- `POST /api/v1/orders/{orderId}/cancel` — new cancel API with
  `OrderCancelRequest`.

In a real session this change is made by Codex or Claude Code; the overlay
keeps the demo reproducible without a model call.
