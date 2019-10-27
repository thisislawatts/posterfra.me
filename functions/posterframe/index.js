const needle = require("needle");
const url = require("url");

const errorThumbnail =
  "https://storage.googleapis.com/posterframe-assets/static.png";

/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.fetchVimeo = async (req, res) => {

  const vimeoUrl = url.parse(req.path.replace(/^\//, ""));
    if (!vimeoUrl.path) {
      return res.redirect(errorThumbnail);
    }
  const vimeoEndpoint =
    "https://vimeo.com/api/oembed.json?url=" +
    vimeoUrl.protocol +
    "//vimeo.com/" +
    vimeoUrl.path.replace(/\D/g, "");
  const response = await needle("get", vimeoEndpoint);

  console.log(`Referer:`, req.get("Referer"));

  if (/vimeo/.test(req.path) === false) {
    return res.redirect(errorThumbnail);
  }

  try {
    const thumbnailUrl = response.body.thumbnail_url
      ? response.body.thumbnail_url.replace(/_[0-9x]+/, "")
      : errorThumbnail;

    return res.redirect(thumbnailUrl);
  } catch (error) {
    return res.json({
      error
    });
  }
};
