// The Skitza lockup that heads the invitation email: the amber app tile,
// the "skitza." wordmark in Syne, and the amber period.
//
// It ships as a base64 PNG attached inline (Content-ID) rather than a
// hosted URL on purpose. Syne is a web font and every mail client strips
// @font-face, so the wordmark has to be an image — and hosting it under
// apps/web/public would mean this email silently shows a broken logo until
// the web app happens to deploy. Embedding keeps the admin app self
// contained. It costs 4 KB per send.
//
// Regenerating it: the source is the live hero at https://skitza.app/opengraph-image
// (1200x630). Crop left=56 top=46 width=344 height=106 — that captures the
// lockup with its amber glow and stops just above the "NOW BOOKING" pill.
// The crop keeps the hero's #0e0d08 background, which is why the header band
// in invitation-email.ts must stay exactly that colour or a seam appears.

/** Referenced from the HTML as <img src="cid:skitzalockup">. */
export const INVITE_LOGO_CID = "skitzalockup";
export const INVITE_LOGO_FILENAME = "skitza.png";

/** Natural size 344x106; rendered at exactly half for retina crispness. */
export const INVITE_LOGO_WIDTH = 172;
export const INVITE_LOGO_HEIGHT = 53;

export const INVITE_LOGO_PNG_BASE64 =
  "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" +
  "MUKWLBF+Os5qYBzudXuEbpGPYFpY9fodwA6KWyujqs86XHd1X44YIjHC5uQIYxeOWG+fsB87Etv2Vp+3kSy+wOj1E1h+/8fP" +
  "YS+L3WA5AmEI6/XHDCvOQrsvWbcNUdr6hWSavDSL5ipkW3bWM4Hf35zwN08dM6rNFtaYFODlARq7ihp7anW7LZq6AV9e29NY" +
  "hEYvvEQwpgWfCIc4gEuIvqxp1SZMEB50dzBWWPuVV5n8wbBUl/g3g1N8x2xgzdkWnRSQiK2Vznktx+CaXUtDlk4LGOzfs+w3" +
  "CxQ2ftWENsGwUmNLNZYRLyyZbZWrYdHyIMLSq006C85hywFszgP77S2VjbDyYduLiYaNINsVyogTFk1j4WyrzroaOBmeUp0B" +
  "bwtYNmHqhPkWn8h+GOkAR/WnZjzS/mgSYDOmNVNsMoHuSjIsXWuFA8t8TTsVCISVV2yoYdf88oHu8ObGIp1MDMGjngwmAxZ9" +
  "MBS0cyHpb0kibFSlgX0l/72vP/jE2hXjQZuztOIQFkoGLKKdnhDflido2SxYtbBohbDp/YfPrlwZRzPa+gl83nNVXS4Y5Od/" +
  "Q/GfAdfBXnXuejUirM1lRilTOtgF57ALeti17oOVp1vnnMMOK6dbStgMN8CKC4Swc9iwaoEgwrrgpiTdkvaPZ5y6nvmzakmb" +
  "s8aFsKpNmNunncLeva3YhMlxI6xy27DupsPha+FmnWLbULkfm/qwio3uuq8WHYXBmcWpumg3ul0BK5+aqW359q4T2MVvW2q1" +
  "p2bcB2s9mdjX0nnu7pnY+/VcZ0uf+mQihd3gFljd6W9v3e7bxYsx5uzCYvH8bhSxqtPf8tXyboM1Qra2Zdftc8WnY2jaM3eL" +
  "z83v4klQJV/IyScF7oFVXmLk7avbvevsreLixc8Xotg3uLrw+WJx8a2zu3aTOYH1EqM1LlvRai+KIy37TutXN4ujrpsXWt8x" +
  "G1a6KE66vcM1sJbLOGnL7ms9NH/sVtgeNXzr2Pyh1n2oYdHqQHUZp9smBcKFxywL8KrWx1p231uH3nj7SPubB4/293cODf0O" +
  "1e9Z4a+Hhjr7+48efLP9yNtvHHprH2tY1YXHbhu7tJfKF+HV124UBlwW0XZ2nqW2tIaGznZ2IlbgShK2SHWpvNvGLu3NHahl" +
  "e2gYmLKYFtvSQqqIFbUrc23Frn09pGEVN3e4LGK1tyPhiQEKAyBLafsxLin05VHcrtwVBSwKAjolUN2OZEasS2DVN9DRMDBl" +
  "GS2yJbr9+NeDjFVwpUGguoHOErEpDau75bOjGk+5iCwZwVDTHmlHthiXFfqmvf0IaleWr9gVTbVQEGhv+XRPxGpvUsZhgGKW" +
  "ybKmRbTYllU7YaXtSl1JwNI5bMSblF0Cq7yt3iJLuhbjYl1iilBJt1pdHd5Wn1qw1pYlYXA4F8Wsj6QBmhswWmprFFJlrGg+" +
  "QHLAhwIWzQgcPggi5WBVjy6pbDJk++paCC21Rbi0DlFVwtqCFlzctanS6aNLUgxW/bCdA0QWpUGjF8UBpcW2CJdXK1alrCgG" +
  "0HwA5wByPaB42E6+4vlQqQ2rezwUkMVNi2mZrVlEFbPidkXzLMk15sdDpVTpHmhmyO6ktLhriS0spIq7lbD6oKuzB5qlFqzm" +
  "EXzNWPZwVW4HblpKi9qW4PJCqKRZMStu147cqsPYtdnpI/hSqnQPjcQ9i+YGVaxpMW0Pwa1FvLjQFxi1h7DSdq1C8wHar84e" +
  "Gpl6z49VPOaUyVY2kabdSW0rvESXFfqygqrSdm2qNFyT+5jT56H+B0aMmLP0AhIMAAAAAElFTkSuQmCC";
