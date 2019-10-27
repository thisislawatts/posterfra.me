const needle = require("needle");
const url = require("url");

const errorThumbnail =
  "https://storage.googleapis.com/posterframe-assets/static.png";

exports.handler = async function (event) {
  console.log({event});
  const vimeoUrl = url.parse(event.path.replace(/^\//, ""));
    if (!vimeoUrl.path) {
      return redirect(errorThumbnail);
    }
  const vimeoEndpoint =
    "https://vimeo.com/api/oembed.json?url=" +
    vimeoUrl.protocol +
    "//vimeo.com/" +
    vimeoUrl.path.replace(/\D/g, "");
  const response = await needle("get", vimeoEndpoint);

  // console.log(`Referer:`, req.get("Referer"));

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
  }
}
