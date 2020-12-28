const needle = require("needle");

const errorThumbnail = "/error";

exports.handler = async function(event, context) {
  const vimeoUrl = event.path.match(/vimeo.com\/[0-9]+/);
  if (!vimeoUrl) {
    return redirect(errorThumbnail);
  }
  const vimeoEndpoint =
    "https://vimeo.com/api/oembed.json?url=" +
    "https://vimeo.com/" +
    vimeoUrl[0].replace(/\D/g, "");
  const response = await needle("get", vimeoEndpoint);

  console.log(`Referer:`, req.get("Referer"));
  console.log(`Video:`, event.path);

  if (/vimeo/.test(event.path) === false) {
    return redirect(errorThumbnail);
  }

  try {
    const thumbnailUrl = response.body.thumbnail_url
      ? response.body.thumbnail_url.replace(/_[0-9x]+/, "")
      : errorThumbnail;

    return redirect(thumbnailUrl);
  } catch (error) {
    return json({
      error
    });
  }
};

function redirect(destination) {
  return {
    statusCode: 301,
    headers: {
      Location: destination
    }
  };
}
