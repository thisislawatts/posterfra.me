const { handler } = require("../posterframe");

test("fetch files", async done => {
  const res = await handler({ path: "/https://vimeo.com/123456" });

  expect(res).toEqual({
    statusCode: 301,
    headers: { Location: "https://i.vimeocdn.com/video/46783763.jpg" }
  });
  done();
});


test("redirect to error page", async done => {
  const res = await handler({ path: "/abc123" });

  expect(res).toEqual({
    statusCode: 301,
    headers: { Location: "/error" }
  });
  done();
});
