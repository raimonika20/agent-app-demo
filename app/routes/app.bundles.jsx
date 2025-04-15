import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Button,
  DataTable,
  Modal,
  TextField,
  Select,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { useSubmit, useLoaderData } from "@remix-run/react";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch regular products for bundle creation
  const productsResponse = await admin.graphql(
    `query getProducts {
      products(first: 20, query: "NOT tag:bundle") {
        edges {
          node {
            id
            title
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }`
  );

  const productsJson = await productsResponse.json();

  return json({
    products: productsJson.data.products.edges
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const bundleData = JSON.parse(formData.get("bundleData"));

  console.log('Creating bundle with data:', bundleData);

  // Create bundle product
  const createProductResponse = await admin.graphql(
    `mutation createProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          metafield(namespace: "custom", key: "bundle_products") {
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          title: bundleData.name,
          descriptionHtml: bundleData.description,
          tags: ["bundle"],
          status: "ACTIVE",
          metafields: [
            {
              namespace: "custom",
              key: "bundle_products",
              type: "json",
              value: JSON.stringify({
                products: bundleData.products,
                discount: parseInt(bundleData.discount)
              })
            }
          ]
        }
      }
    }
  );

  const response = await createProductResponse.json();
  console.log('Bundle creation response:', response);

  if (response.data?.productCreate?.userErrors?.length > 0) {
    return json({ error: response.data.productCreate.userErrors[0].message }, { status: 400 });
  }

  // Return a redirect to force a page reload
  return json({ success: true, product: response.data.productCreate.product });
};

export default function BundleCreator() {
  const { products } = useLoaderData();
  const submit = useSubmit();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [bundleName, setBundleName] = useState("");
  const [bundleDescription, setBundleDescription] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [discountPercentage, setDiscountPercentage] = useState("10");

  const handleCreateBundle = useCallback(() => {
    const bundleData = {
      name: bundleName,
      description: bundleDescription,
      products: selectedProducts,
      discount: parseInt(discountPercentage)
    };

    submit(
      { bundleData: JSON.stringify(bundleData) },
      { method: "post", replace: true }
    );

    setBundleName("");
    setBundleDescription("");
    setSelectedProducts([]);
    setDiscountPercentage("10");
    setIsModalOpen(false);
  }, [bundleName, bundleDescription, selectedProducts, discountPercentage, submit]);

  const rows = products.map(({ node }) => {
    const price = parseFloat(node.priceRangeV2.minVariantPrice.amount).toFixed(2);
    return [
      node.title,
      `$${price}`,
      <Button
        key={node.id}
        onClick={() => {
          if (!selectedProducts.includes(node.id)) {
            setSelectedProducts([...selectedProducts, node.id]);
          }
        }}
        disabled={selectedProducts.includes(node.id)}
      >
        Add to Bundle
      </Button>
    ];
  });

  const selectedProductRows = selectedProducts.map(productId => {
    const product = products.find(({ node }) => node.id === productId)?.node;
    if (!product) return null;

    const price = parseFloat(product.priceRangeV2.minVariantPrice.amount).toFixed(2);
    return [
      product.title,
      `$${price}`,
      <Button
        key={product.id}
        destructive
        onClick={() => setSelectedProducts(selectedProducts.filter(id => id !== productId))}
      >
        Remove
      </Button>
    ];
  }).filter(Boolean);

  const totalBundlePrice = selectedProductRows.reduce((sum, row) => {
    const price = parseFloat(row[1].replace('$', ''));
    return sum + price;
  }, 0);

  const discountedBundlePrice = totalBundlePrice * (1 - parseInt(discountPercentage) / 100);

  return (
    <Page
      title="Bundle Creator"
      primaryAction={{
        content: "Create New Bundle",
        onAction: () => setIsModalOpen(true),
      }}
      secondaryActions={[
        {
          content: "View Created Bundles",
          url: "/app/created-bundles"
        }
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Available Products</Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text"]}
                headings={["Product", "Price", "Action"]}
                rows={rows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Create Bundle Modal */}
        <Modal
          open={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedProducts([]);
            setBundleName("");
            setBundleDescription("");
            setDiscountPercentage("10");
          }}
          title="Create New Bundle"
          primaryAction={{
            content: "Create Bundle",
            onAction: handleCreateBundle,
            disabled: selectedProducts.length === 0 || !bundleName
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => {
                setIsModalOpen(false);
                setSelectedProducts([]);
                setBundleName("");
                setBundleDescription("");
                setDiscountPercentage("10");
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Bundle Name"
                value={bundleName}
                onChange={setBundleName}
                autoComplete="off"
                required
              />
              <TextField
                label="Description"
                value={bundleDescription}
                onChange={setBundleDescription}
                multiline={4}
              />
              <Select
                label="Discount Percentage"
                options={["5", "10", "15", "20", "25"]}
                value={discountPercentage}
                onChange={setDiscountPercentage}
              />

              {selectedProductRows.length > 0 && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Selected Products</Text>
                    <DataTable
                      columnContentTypes={["text", "numeric", "text"]}
                      headings={["Product", "Price", "Action"]}
                      rows={selectedProductRows}
                    />
                    <BlockStack gap="200">
                      <Text variant="bodySm">Total Price: ${totalBundlePrice.toFixed(2)}</Text>
                      <Text variant="bodyMd">Discounted Price: ${discountedBundlePrice.toFixed(2)}</Text>
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Layout>
    </Page>
  );
}
