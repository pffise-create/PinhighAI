// MessageBubble.test.js - Component tests for chat message rendering
// Tests: coach borderless markdown, user bubble styling, video thumbnail tap

describe('MessageBubble', () => {
  describe('coach messages', () => {
    it.todo('renders as borderless markdown (no bubble background)');
    it.todo('renders full-width left-aligned');
    it.todo('handles markdown formatting (bold, lists, headings)');
    it.todo('renders empty string gracefully');
  });

  describe('user messages', () => {
    it.todo('renders with brandForest background bubble');
    it.todo('renders right-aligned with max 85% width');
    it.todo('renders white text on dark bubble');
    it.todo('renders text-only message without video thumbnail');
  });

  describe('video messages', () => {
    it.todo('renders VideoPlayer thumbnail when videoThumbnail exists');
    it.todo('renders text below video thumbnail when both present');
    it.todo('calls onVideoPress when thumbnail tapped');
  });
});
